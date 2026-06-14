import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { pollReceiptOnce } from "../lib/contract.js";
import { writeEventForTx } from "../lib/events.js";

const router = Router();

// GET /api/transactions — caller's transaction history
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const txs = await prisma.contractTransaction.findMany({
      where: { userAddress: req.walletAddress ?? undefined },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ transactions: txs });
  } catch (err) {
    console.error("[transactions/list]", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// GET /api/transactions/:txHash — poll individual tx status
// On each call, if the tx is PENDING and older than 30s, this route attempts
// a non-blocking receipt check and updates the DB if finalised.
router.get("/:txHash", requireAuth, async (req: AuthRequest, res) => {
  try {
    const tx = await prisma.contractTransaction.findUnique({
      where: { txHash: String(req.params.txHash) },
    });

    if (!tx) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    // Only the tx submitter or an admin may poll
    const isOwner = tx.userAddress === req.walletAddress;
    const isAdmin = req.user!.role === "ADMIN";
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Lazy finality check for PENDING txs older than 30 seconds
    if (
      tx.status === "PENDING" &&
      tx.createdAt < new Date(Date.now() - 30_000)
    ) {
      const outcome = await pollReceiptOnce(tx.txHash);
      if (outcome) {
        const updated = await prisma.contractTransaction.update({
          where: { id: tx.id },
          data: {
            status: "FINALIZED",
            executionResult: outcome.executionResult ?? undefined,
            errorDescription: outcome.errorDescription ?? undefined,
          },
        });

        // Write contract event — non-blocking so response isn't delayed
        writeEventForTx({
          txHash: tx.txHash,
          txType: tx.txType,
          onChainMarketId: tx.onChainMarketId,
          userAddress: tx.userAddress,
          valueWei: tx.valueWei,
          executionResult: outcome.executionResult,
          errorDescription: outcome.errorDescription,
        }).catch(err =>
          console.error(`[transactions/poll] event write error for ${tx.txHash}:`, err)
        );

        res.json({ transaction: updated });
        return;
      }
    }

    res.json({ transaction: tx });
  } catch (err) {
    console.error("[transactions/poll]", err);
    res.status(500).json({ error: "Failed to fetch transaction" });
  }
});

export default router;
