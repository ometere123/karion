// POSTGRES IS CACHE ONLY for market financial state.
// The KarionMarket contract at GENLAYER_CONTRACT_ADDRESS is the sole source of
// truth for pools, status, outcome, positions, and claimed state.
// These routes read the cache for listings and always hit the contract for
// fresh position data and before routing claim transactions.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import {
  requireAuth,
  requireWalletReady,
  type AuthRequest,
} from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  getMarket,
  getPosition,
  stakeYes,
  stakeNo,
  claimPayout,
  claimRefund,
} from "../lib/contract.js";
import { createUserAccountFromSession } from "../lib/wallet-signer.js";

const router = Router();

async function fetchStudioNetBalance(address: string): Promise<bigint> {
  const res = await fetch(process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
      id: 1,
    }),
  });
  const json = (await res.json()) as { result?: string };
  if (!json.result) throw new Error("StudioNet balance check failed");
  return BigInt(json.result);
}

// ── Amount validation helpers ─────────────────────────────────────────────────
// All GEN amounts use BigInt only — Number() is never used for wei values.

const stakeSchema = z.object({
  amountWei: z
    .string()
    .regex(/^\d+$/, "amountWei must be a non-negative decimal integer string"),
  confirm: z.literal(true, {
    errorMap: () => ({ message: "confirm must be true" }),
  }),
});

const claimSchema = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: "confirm must be true" }),
  }),
});

function parseStakeAmount(amountWei: string): bigint | null {
  try {
    const val = BigInt(amountWei);
    return val > 0n ? val : null;
  } catch {
    return null;
  }
}

// ── GET /api/markets — list all markets (DB cache) ────────────────────────────

router.get("/", requireAuth, async (_req, res) => {
  try {
    const markets = await prisma.market.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        onChainMarketId: true,
        question: true,
        category: true,
        status: true,
        resolutionDeadline: true,
        yesPoolCached: true,
        noPoolCached: true,
        totalPoolCached: true,
        finalOutcomeCached: true,
        confidence: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    });
    res.json({ markets });
  } catch (err) {
    console.error("[markets/list]", err);
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// ── GET /api/markets/:id — detail with fresh contract read ────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const onChainMarketId = String(req.params.id);
  try {
    const market = await prisma.market.findUnique({
      where: { onChainMarketId },
    });

    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }

    // Fresh contract read — never serve stale financial data for detail view
    let onChain: Awaited<ReturnType<typeof getMarket>> | null = null;
    try {
      onChain = await getMarket(onChainMarketId);
    } catch (err) {
      console.error(
        `[markets/detail] contract read failed for ${onChainMarketId}:`,
        err
      );
    }

    res.json({ market, onChain });
  } catch (err) {
    console.error("[markets/detail]", err);
    res.status(500).json({ error: "Failed to fetch market" });
  }
});

// ── GET /api/markets/:id/position — caller's on-chain position ────────────────

router.get("/:id/position", requireAuth, async (req: AuthRequest, res) => {
  const onChainMarketId = String(req.params.id);
  try {
    if (!req.walletAddress) {
      res.status(409).json({ error: "No wallet associated with this account" });
      return;
    }

    const position = await getPosition(onChainMarketId, req.walletAddress);
    res.json({ position, walletAddress: req.walletAddress });
  } catch (err) {
    console.error("[markets/position]", err);
    res.status(500).json({ error: "Failed to fetch position" });
  }
});

// ── POST /api/markets/:id/stake/yes ───────────────────────────────────────────

router.post(
  "/:id/stake/yes",
  requireAuth,
  requireWalletReady,
  validate(stakeSchema),
  async (req: AuthRequest, res) => {
    const onChainMarketId = String(req.params.id);
    const { amountWei } = req.body as z.infer<typeof stakeSchema>;

    const amount = parseStakeAmount(amountWei);
    if (!amount) {
      res.status(400).json({ error: "amountWei must be a positive integer" });
      return;
    }

    const minStake = process.env.MIN_STAKE_WEI
      ? BigInt(process.env.MIN_STAKE_WEI)
      : 0n;
    if (amount < minStake) {
      res.status(400).json({
        error: `amountWei must be at least ${minStake.toString()} wei`,
      });
      return;
    }

    try {
      const { account, walletAddress } = await createUserAccountFromSession(
        req.user!.id,
        req.sessionEncryptedWek!
      );

      const balance = await fetchStudioNetBalance(walletAddress);
      if (balance < amount) {
        res.status(409).json({
          error: "Insufficient wallet balance",
          balanceWei: balance.toString(),
          requiredWei: amount.toString(),
        });
        return;
      }

      const txHash = await stakeYes(account, onChainMarketId, amount);

      await prisma.contractTransaction.create({
        data: {
          txHash,
          txType: "STAKE_YES",
          onChainMarketId,
          userAddress: walletAddress,
          valueWei: amount.toString(),
          status: "PENDING",
        },
      });

      // Optimistically upsert position cache
      const dbMarket = await prisma.market.findUnique({
        where: { onChainMarketId },
        select: { id: true },
      });
      if (dbMarket) {
        await prisma.marketPosition.upsert({
          where: {
            userId_marketId_side: {
              userId: req.user!.id,
              marketId: dbMarket.id,
              side: "YES",
            },
          },
          update: { transactionHash: txHash },
          create: {
            userId: req.user!.id,
            marketId: dbMarket.id,
            onChainMarketId,
            side: "YES",
            amountGen: amount.toString(),
            transactionHash: txHash,
          },
        });
      }

      await prisma.adminAuditLog.create({
        data: {
          userId: req.user!.id,
          action: "STAKE_YES",
          targetType: "MARKET",
          targetId: onChainMarketId,
          metadata: { txHash, amountWei: amount.toString(), walletAddress },
        },
      });

      res.json({ txHash, status: "PENDING", amountWei: amount.toString() });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "WALLET_NOT_FOUND") {
        res.status(409).json({ error: "Wallet not found" });
        return;
      }
      if (err instanceof Error && err.message === "DECRYPT_FAILED") {
        res.status(500).json({ error: "Failed to decrypt wallet" });
        return;
      }
      console.error("[stake_yes]", err);
      res.status(500).json({ error: "Stake failed" });
    }
  }
);

// ── POST /api/markets/:id/stake/no ────────────────────────────────────────────

router.post(
  "/:id/stake/no",
  requireAuth,
  requireWalletReady,
  validate(stakeSchema),
  async (req: AuthRequest, res) => {
    const onChainMarketId = String(req.params.id);
    const { amountWei } = req.body as z.infer<typeof stakeSchema>;

    const amount = parseStakeAmount(amountWei);
    if (!amount) {
      res.status(400).json({ error: "amountWei must be a positive integer" });
      return;
    }

    const minStake = process.env.MIN_STAKE_WEI
      ? BigInt(process.env.MIN_STAKE_WEI)
      : 0n;
    if (amount < minStake) {
      res.status(400).json({
        error: `amountWei must be at least ${minStake.toString()} wei`,
      });
      return;
    }

    try {
      const { account, walletAddress } = await createUserAccountFromSession(
        req.user!.id,
        req.sessionEncryptedWek!
      );

      const balance = await fetchStudioNetBalance(walletAddress);
      if (balance < amount) {
        res.status(409).json({
          error: "Insufficient wallet balance",
          balanceWei: balance.toString(),
          requiredWei: amount.toString(),
        });
        return;
      }

      const txHash = await stakeNo(account, onChainMarketId, amount);

      await prisma.contractTransaction.create({
        data: {
          txHash,
          txType: "STAKE_NO",
          onChainMarketId,
          userAddress: walletAddress,
          valueWei: amount.toString(),
          status: "PENDING",
        },
      });

      const dbMarket = await prisma.market.findUnique({
        where: { onChainMarketId },
        select: { id: true },
      });
      if (dbMarket) {
        await prisma.marketPosition.upsert({
          where: {
            userId_marketId_side: {
              userId: req.user!.id,
              marketId: dbMarket.id,
              side: "NO",
            },
          },
          update: { transactionHash: txHash },
          create: {
            userId: req.user!.id,
            marketId: dbMarket.id,
            onChainMarketId,
            side: "NO",
            amountGen: amount.toString(),
            transactionHash: txHash,
          },
        });
      }

      await prisma.adminAuditLog.create({
        data: {
          userId: req.user!.id,
          action: "STAKE_NO",
          targetType: "MARKET",
          targetId: onChainMarketId,
          metadata: { txHash, amountWei: amount.toString(), walletAddress },
        },
      });

      res.json({ txHash, status: "PENDING", amountWei: amount.toString() });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "WALLET_NOT_FOUND") {
        res.status(409).json({ error: "Wallet not found" });
        return;
      }
      if (err instanceof Error && err.message === "DECRYPT_FAILED") {
        res.status(500).json({ error: "Failed to decrypt wallet" });
        return;
      }
      console.error("[stake_no]", err);
      res.status(500).json({ error: "Stake failed" });
    }
  }
);

// ── POST /api/markets/:id/claim ───────────────────────────────────────────────
// Reads contract status first to determine claim_payout vs claim_refund.
// The contract controls claim eligibility — the backend never decides it.

router.post(
  "/:id/claim",
  requireAuth,
  requireWalletReady,
  validate(claimSchema),
  async (req: AuthRequest, res) => {
    const onChainMarketId = String(req.params.id);

    try {
      // Read on-chain status — contract is the only authority for claim routing
      const onChain = await getMarket(onChainMarketId);
      const { status } = onChain;

      if (status === "OPEN" || status === "LOCKED" || status === "RESOLVING") {
        res.status(409).json({
          error: "Market has not been resolved yet",
          marketStatus: status,
        });
        return;
      }

      const { account, walletAddress } = await createUserAccountFromSession(
        req.user!.id,
        req.sessionEncryptedWek!
      );

      let txHash: string;
      let txType: string;

      if (status === "RESOLVED") {
        txHash = await claimPayout(account, onChainMarketId);
        txType = "CLAIM_PAYOUT";
      } else if (
        status === "INVALID" ||
        status === "UNRESOLVED" ||
        status === "CANCELLED"
      ) {
        txHash = await claimRefund(account, onChainMarketId);
        txType = "CLAIM_REFUND";
      } else {
        res.status(409).json({
          error: "Cannot claim on market with status: " + status,
          marketStatus: status,
        });
        return;
      }

      await prisma.contractTransaction.create({
        data: {
          txHash,
          txType,
          onChainMarketId,
          userAddress: walletAddress,
          status: "PENDING",
        },
      });

      await prisma.adminAuditLog.create({
        data: {
          userId: req.user!.id,
          action: txType,
          targetType: "MARKET",
          targetId: onChainMarketId,
          metadata: { txHash, walletAddress, marketStatus: status },
        },
      });

      res.json({ txHash, status: "PENDING", txType, marketStatus: status });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "WALLET_NOT_FOUND") {
        res.status(409).json({ error: "Wallet not found" });
        return;
      }
      if (err instanceof Error && err.message === "DECRYPT_FAILED") {
        res.status(500).json({ error: "Failed to decrypt wallet" });
        return;
      }
      console.error("[claim]", err);
      res.status(500).json({ error: "Claim failed" });
    }
  }
);

// ── GET /api/markets/:id/activity — per-market event timeline ─────────────────
// Returns ContractEvent rows for display purposes only.
// These are history records — contract reads remain authoritative.

router.get("/:id/activity", requireAuth, async (req, res) => {
  const onChainMarketId = String(req.params.id);
  try {
    const market = await prisma.market.findUnique({
      where: { onChainMarketId },
      select: { id: true },
    });

    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }

    const events = await prisma.contractEvent.findMany({
      where: { marketId: market.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    res.json({ events });
  } catch (err) {
    console.error("[markets/activity]", err);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

export default router;
