import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { exportKeyLimiter } from "../middleware/rateLimit.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { exportPrivateKey } from "../services/wallet.service.js";

const STUDIONNET_RPC = "https://studio.genlayer.com/api";

async function fetchStudioNetBalance(address: string): Promise<string> {
  const res = await fetch(STUDIONNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
      id: 1,
    }),
  });
  const json = (await res.json()) as { result?: string; error?: unknown };
  if (!json.result) throw new Error("StudioNet RPC returned no balance result");
  // result is hex (e.g. "0x16345785d8a0000") — convert to decimal string via BigInt
  return BigInt(json.result).toString();
}

// Number() used only for display formatting, not transaction decisions.
function weiToGENDisplay(weiStr: string): string {
  const wei = BigInt(weiStr);
  const gen = Number(wei) / 1e18;
  return gen.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

const router = Router();

// GET /api/wallet/balance
// Returns the authenticated user's embedded wallet GEN balance from StudioNet.
// balanceWei is a BigInt-derived decimal string — safe for BigInt comparisons.
// balanceGEN is a display string only (Number() division, 4dp).
router.get("/balance", requireAuth, async (req: AuthRequest, res) => {
  const walletAddress = req.walletAddress;
  if (!walletAddress) {
    res.status(409).json({ error: "No wallet found for this account" });
    return;
  }
  try {
    const balanceWei = await fetchStudioNetBalance(walletAddress);
    res.json({
      walletAddress,
      balanceWei,
      balanceGEN: weiToGENDisplay(balanceWei),
      network: "StudioNet",
      chainId: 61999,
      token: "GEN",
    });
  } catch (err) {
    console.error("[wallet/balance]", err);
    res.status(503).json({ error: "Could not fetch balance from StudioNet" });
  }
});

const exportKeySchema = z.object({
  password: z.string().min(1, "Password required"),
});

// POST /api/wallet/export-key
// Requires re-authentication with current password. Logged in audit trail.
router.post(
  "/export-key",
  exportKeyLimiter,
  requireAuth,
  validate(exportKeySchema),
  async (req: AuthRequest, res) => {
    try {
      const { password } = req.body as z.infer<typeof exportKeySchema>;
      const privateKey = await exportPrivateKey(
        req.user!.id,
        password,
        req.ip,
        req.headers["user-agent"] ?? null
      );
      res.json({
        privateKey,
        warning:
          "Store this key securely and never share it. This request has been logged.",
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === "INVALID_CREDENTIALS") {
          res.status(401).json({ error: "Incorrect password" });
          return;
        }
        if (err.message === "WALLET_NOT_FOUND") {
          res.status(404).json({ error: "No wallet found for this account" });
          return;
        }
      }
      console.error("[export-key]", err);
      res.status(500).json({ error: "Export failed" });
    }
  }
);

export default router;
