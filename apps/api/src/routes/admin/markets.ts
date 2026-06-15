import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { requireAdmin, type AuthRequest } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { createMarket, lockMarket, resolveMarket, waitForReceipt } from "../../lib/contract.js";
import { CONTRACT_ADDRESS } from "../../lib/genlayer-client.js";
import { writeEventForTx } from "../../lib/events.js";
import { getResolveCooldown } from "../../lib/resolution.js";

const router = Router();

const confirmSchema = z.object({ confirm: z.literal(true) });

// GET /api/admin/markets — list all markets with optional status filter
router.get("/", requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const markets = await prisma.market.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        suggestion: { select: { id: true } },
        _count: { select: { positions: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ markets });
  } catch (err) {
    console.error("[admin/markets/list]", err);
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// GET /api/admin/markets/sync-status
router.get("/sync-status", requireAdmin, async (req, res) => {
  try {
    const workerEnabled = process.env.ENABLE_MARKET_SYNC === "true";
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const [totalMarkets, staleMarkets] = await Promise.all([
      prisma.market.count(),
      prisma.market.findMany({
        where: {
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: tenMinutesAgo } }],
          status: { in: ["OPEN", "LOCKED", "RESOLVING"] },
        },
        select: {
          id: true,
          onChainMarketId: true,
          question: true,
          status: true,
          lastSyncedAt: true,
          updatedAt: true,
        },
        orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
        take: 50,
      }),
    ]);

    res.json({
      workerEnabled,
      totalMarkets,
      staleCount: staleMarkets.length,
      staleMarkets,
      lastCheckedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[admin/markets/sync-status]", err);
    res.status(500).json({ error: "Failed to fetch sync status" });
  }
});

// GET /api/admin/markets/transactions — all contract tx history (admin view)
router.get("/transactions", requireAdmin, async (req, res) => {
  try {
    const marketId = req.query.marketId as string | undefined;
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const userAddress = req.query.userAddress as string | undefined;

    const txs = await prisma.contractTransaction.findMany({
      where: {
        ...(marketId ? { onChainMarketId: marketId } : {}),
        ...(status ? { status } : {}),
        ...(type ? { txType: type } : {}),
        ...(userAddress
          ? { userAddress: { contains: userAddress, mode: "insensitive" } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    res.json({ transactions: txs });
  } catch (err) {
    console.error("[admin/transactions/list]", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

const directCreateSchema = z.object({
  confirm: z.literal(true),
  question: z.string().min(10).max(500),
  category: z.string().min(1).max(100),
  yesCondition: z.string().min(5).max(500),
  noCondition: z.string().min(5).max(500),
  invalidCondition: z.string().min(5).max(500),
  resolutionUrl: z.string().url().max(2000),
  resolutionQuery: z.string().min(10).max(1000),
  resolutionDeadline: z.string().min(1),
});

// POST /api/admin/markets/direct — create a market without a suggestion
// Admin bypasses the suggestion queue and creates on-chain directly.
// Requires confirm:true. Waits for finality.
router.post("/direct", requireAdmin, validate(directCreateSchema), async (req: AuthRequest, res) => {
  try {
    const {
      question, category, yesCondition, noCondition,
      invalidCondition, resolutionUrl, resolutionQuery, resolutionDeadline: deadlineStr,
    } = req.body as z.infer<typeof directCreateSchema>;

    const deadline = new Date(deadlineStr);
    if (isNaN(deadline.getTime())) {
      res.status(400).json({ error: "Invalid resolutionDeadline" });
      return;
    }
    const deadlineUnix = BigInt(Math.floor(deadline.getTime() / 1000));
    if (deadlineUnix <= BigInt(Math.floor(Date.now() / 1000))) {
      res.status(409).json({ error: "Resolution deadline must be in the future" });
      return;
    }

    const onChainMarketId = `mkt-d-${Date.now()}`;

    const txHash = await createMarket({
      marketId: onChainMarketId,
      question,
      yesCondition,
      noCondition,
      invalidCondition,
      resolutionUrl,
      resolutionQuery,
      deadline: deadlineUnix,
    });

    await prisma.contractTransaction.create({
      data: { txHash, txType: "CREATE_MARKET", onChainMarketId, status: "PENDING" },
    });

    await prisma.adminAuditLog.create({
      data: {
        userId: req.user!.id,
        action: "CREATE_MARKET_DIRECT",
        targetType: "MARKET",
        targetId: onChainMarketId,
        metadata: { onChainMarketId, txHash, question },
      },
    });

    console.log(`[admin/direct-create] waiting for finality: ${txHash}`);
    const receipt = await waitForReceipt(txHash, 300);

    await prisma.contractTransaction.update({
      where: { txHash },
      data: {
        status: "FINALIZED",
        executionResult: receipt.executionResult ?? undefined,
        errorDescription: receipt.errorDescription ?? undefined,
      },
    });

    writeEventForTx({
      txHash,
      txType: "CREATE_MARKET",
      onChainMarketId,
      userAddress: null,
      valueWei: null,
      executionResult: receipt.executionResult,
      errorDescription: receipt.errorDescription ?? null,
    }).catch((err) => console.error("[admin/direct-create] event write error:", err));

    if (receipt.executionResult !== "SUCCESS") {
      res.status(422).json({
        error: "Contract rejected create_market",
        txHash,
        executionResult: receipt.executionResult,
        errorDescription: receipt.errorDescription,
      });
      return;
    }

    const market = await prisma.market.create({
      data: {
        suggestionId: null,
        onChainMarketId,
        contractAddress: CONTRACT_ADDRESS,
        question,
        category,
        yesCondition,
        noCondition,
        invalidCondition,
        resolutionUrl,
        resolutionQuery,
        resolutionDeadline: deadline,
        status: "OPEN",
        lastSyncedAt: new Date(),
      },
    });

    res.status(201).json({ market, txHash, executionResult: "SUCCESS" });
  } catch (err) {
    console.error("[admin/markets/direct]", err);
    res.status(500).json({ error: "Failed to create market" });
  }
});

// GET /api/admin/markets/:id/resolve-attempts
// Returns all MarketResolutionAttempt rows for a market plus current cooldown status.
router.get("/:id/resolve-attempts", requireAdmin, async (req, res) => {
  const onChainMarketId = String(req.params.id);
  try {
    const dbMarket = await prisma.market.findUnique({
      where: { onChainMarketId },
      select: { id: true },
    });
    if (!dbMarket) {
      res.status(404).json({ error: "Market not found" });
      return;
    }

    const [attempts, cooldownUntil] = await Promise.all([
      prisma.marketResolutionAttempt.findMany({
        where: { marketId: dbMarket.id },
        orderBy: { attemptedAt: "desc" },
        take: 50,
      }),
      getResolveCooldown(dbMarket.id),
    ]);

    res.json({
      attempts,
      cooldownUntil: cooldownUntil?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("[admin/markets/resolve-attempts]", err);
    res.status(500).json({ error: "Failed to fetch resolve attempts" });
  }
});

// POST /api/admin/markets/:id/lock — trigger lock_market on-chain
router.post(
  "/:id/lock",
  requireAdmin,
  validate(confirmSchema),
  async (req: AuthRequest, res) => {
    const onChainMarketId = String(req.params.id);
    try {
      const dbMarket = await prisma.market.findUnique({ where: { onChainMarketId } });
      if (!dbMarket) {
        res.status(404).json({ error: "Market not found" });
        return;
      }
      if (dbMarket.status !== "OPEN") {
        res.status(409).json({
          error: `Market is ${dbMarket.status}, not OPEN. Cannot lock.`,
        });
        return;
      }

      const txHash = await lockMarket(onChainMarketId);

      await prisma.contractTransaction.create({
        data: { txHash, txType: "LOCK_MARKET", onChainMarketId, status: "PENDING" },
      });

      await prisma.adminAuditLog.create({
        data: {
          userId: req.user!.id,
          action: "LOCK_MARKET",
          targetType: "MARKET",
          targetId: dbMarket.id,
          metadata: { onChainMarketId, txHash },
        },
      });

      const receipt = await waitForReceipt(txHash, 200);

      await prisma.contractTransaction.update({
        where: { txHash },
        data: {
          status: "FINALIZED",
          executionResult: receipt.executionResult ?? undefined,
          errorDescription: receipt.errorDescription ?? undefined,
        },
      });

      if (receipt.executionResult === "SUCCESS") {
        await prisma.market.update({
          where: { onChainMarketId },
          data: { status: "LOCKED", lastSyncedAt: new Date() },
        });
      } else {
        await prisma.adminAuditLog.create({
          data: {
            userId: req.user!.id,
            action: "LOCK_MARKET_FAILED",
            targetType: "MARKET",
            targetId: dbMarket.id,
            metadata: {
              onChainMarketId,
              txHash,
              errorDescription: receipt.errorDescription,
            },
          },
        });
      }

      writeEventForTx({
        txHash,
        txType: "LOCK_MARKET",
        onChainMarketId,
        userAddress: null,
        valueWei: null,
        executionResult: receipt.executionResult,
        errorDescription: receipt.errorDescription ?? null,
      }).catch(err => console.error("[admin/markets/lock] event write error:", err));

      res.json({
        txHash,
        executionResult: receipt.executionResult,
        errorDescription: receipt.errorDescription ?? null,
      });
    } catch (err) {
      console.error("[admin/markets/lock]", err);
      res.status(500).json({ error: "Failed to lock market" });
    }
  },
);

// POST /api/admin/markets/:id/resolve — trigger resolve_market on-chain
// Requires confirm:true. GenLayer AI consensus determines the outcome.
// Admin cannot set outcome manually — this only fires the contract call.
// Respects retry cooldown: same 10-minute window as the auto-resolve worker.
router.post(
  "/:id/resolve",
  requireAdmin,
  validate(confirmSchema),
  async (req: AuthRequest, res) => {
    const onChainMarketId = String(req.params.id);
    try {
      const dbMarket = await prisma.market.findUnique({ where: { onChainMarketId } });
      if (!dbMarket) {
        res.status(404).json({ error: "Market not found" });
        return;
      }

      if (!["LOCKED", "RESOLVING"].includes(dbMarket.status)) {
        res.status(409).json({
          error: `Market is ${dbMarket.status}. Must be LOCKED to trigger resolve.`,
        });
        return;
      }

      const pendingResolve = await prisma.contractTransaction.findFirst({
        where: { onChainMarketId, txType: "RESOLVE_MARKET", status: "PENDING" },
      });
      if (pendingResolve) {
        res.status(409).json({
          error: "A resolve_market tx is already pending for this market",
          txHash: pendingResolve.txHash,
        });
        return;
      }

      // Cooldown guard — same window as the auto-resolve worker
      const cooldownUntil = await getResolveCooldown(dbMarket.id);
      if (cooldownUntil) {
        res.status(409).json({
          error: "Market is in resolve cooldown. Retry after the cooldown expires.",
          cooldownUntil: cooldownUntil.toISOString(),
        });
        return;
      }

      // Record attempt before submission — if tx submission throws, FAILED is set below
      const attempt = await prisma.marketResolutionAttempt.create({
        data: {
          marketId: dbMarket.id,
          triggeredBy: req.user!.id,
          status: "PENDING",
        },
      });

      let txHash: string;
      try {
        txHash = await resolveMarket(onChainMarketId);
      } catch (err) {
        // Tx was never submitted — mark attempt FAILED immediately so cooldown starts
        await prisma.marketResolutionAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "FAILED",
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        });
        throw err;
      }

      // Attach txHash now that we have it
      await prisma.marketResolutionAttempt.update({
        where: { id: attempt.id },
        data: { transactionHash: txHash },
      });

      await prisma.contractTransaction.create({
        data: { txHash, txType: "RESOLVE_MARKET", onChainMarketId, status: "PENDING" },
      });

      await prisma.market.update({
        where: { onChainMarketId },
        data: { status: "RESOLVING" },
      });

      await prisma.adminAuditLog.create({
        data: {
          userId: req.user!.id,
          action: "TRIGGER_RESOLVE",
          targetType: "MARKET",
          targetId: dbMarket.id,
          metadata: { onChainMarketId, txHash },
        },
      });

      // resolve_market runs GenLayer consensus — can take minutes.
      // Return txHash immediately; caller polls GET /api/transactions/:txHash.
      res.json({
        txHash,
        status: "PENDING",
        note: "GenLayer consensus is running. Poll GET /api/transactions/:txHash for finality.",
      });
    } catch (err) {
      console.error("[admin/markets/resolve]", err);

      try {
        const dbMarket = await prisma.market.findUnique({
          where: { onChainMarketId },
          select: { id: true },
        });
        if (dbMarket) {
          await prisma.adminAuditLog.create({
            data: {
              userId: req.user?.id ?? null,
              action: "TRIGGER_RESOLVE_FAILED",
              targetType: "MARKET",
              targetId: dbMarket.id,
              metadata: {
                onChainMarketId,
                error: err instanceof Error ? err.message : String(err),
              },
            },
          });
        }
      } catch {
        // best-effort audit
      }

      res.status(500).json({ error: "Failed to trigger resolution" });
    }
  },
);

export default router;
