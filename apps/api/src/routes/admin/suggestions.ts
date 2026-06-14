import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { requireAdmin, type AuthRequest } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { createMarket, waitForReceipt } from "../../lib/contract.js";
import { CONTRACT_ADDRESS } from "../../lib/genlayer-client.js";
import { writeEventForTx } from "../../lib/events.js";

const router = Router();

const approveSchema = z.object({
  reviewNotes: z.string().max(1000).optional(),
});

const rejectSchema = z.object({
  reviewNotes: z.string().min(1, "Rejection reason is required").max(1000),
});

// GET /api/admin/suggestions — list all suggestions
router.get("/", requireAdmin, async (req: AuthRequest, res) => {
  try {
    const status = req.query.status as string | undefined;

    const suggestions = await prisma.marketSuggestion.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        suggestedBy: { select: { id: true, email: true } },
        reviewedBy: { select: { id: true, email: true } },
        market: { select: { onChainMarketId: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ suggestions });
  } catch (err) {
    console.error("[admin/suggestions/list]", err);
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

// GET /api/admin/suggestions/:id — single suggestion detail
router.get("/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  try {
    const suggestion = await prisma.marketSuggestion.findUnique({
      where: { id },
      include: {
        suggestedBy: { select: { id: true, email: true } },
        reviewedBy: { select: { id: true, email: true } },
        market: true,
      },
    });

    if (!suggestion) {
      res.status(404).json({ error: "Suggestion not found" });
      return;
    }

    res.json({ suggestion });
  } catch (err) {
    console.error("[admin/suggestions/detail]", err);
    res.status(500).json({ error: "Failed to fetch suggestion" });
  }
});

// POST /api/admin/suggestions/:id/approve
router.post(
  "/:id/approve",
  requireAdmin,
  validate(approveSchema),
  async (req: AuthRequest, res) => {
    const id = String(req.params.id);
    try {
      const suggestion = await prisma.marketSuggestion.findUnique({
        where: { id },
      });

      if (!suggestion) {
        res.status(404).json({ error: "Suggestion not found" });
        return;
      }

      if (!["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED"].includes(suggestion.status)) {
        res.status(409).json({
          error: `Cannot approve suggestion with status: ${suggestion.status}`,
        });
        return;
      }

      if (!suggestion.resolutionUrl) {
        res.status(409).json({
          error: "Suggestion must have resolutionUrl set before it can be approved",
        });
        return;
      }

      const updated = await prisma.marketSuggestion.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedByUserId: req.user!.id,
          reviewNotes: (req.body.reviewNotes as string | undefined) ?? null,
        },
      });

      await prisma.adminAuditLog.create({
        data: {
          userId: req.user!.id,
          action: "APPROVE_SUGGESTION",
          targetType: "SUGGESTION",
          targetId: suggestion.id,
          metadata: { reviewNotes: req.body.reviewNotes ?? null },
        },
      });

      res.json({ suggestion: updated });
    } catch (err) {
      console.error("[admin/suggestions/approve]", err);
      res.status(500).json({ error: "Failed to approve suggestion" });
    }
  }
);

// POST /api/admin/suggestions/:id/reject
router.post(
  "/:id/reject",
  requireAdmin,
  validate(rejectSchema),
  async (req: AuthRequest, res) => {
    const id = String(req.params.id);
    try {
      const suggestion = await prisma.marketSuggestion.findUnique({
        where: { id },
      });

      if (!suggestion) {
        res.status(404).json({ error: "Suggestion not found" });
        return;
      }

      if (["REJECTED", "CREATED"].includes(suggestion.status)) {
        res.status(409).json({
          error: `Cannot reject suggestion with status: ${suggestion.status}`,
        });
        return;
      }

      const updated = await prisma.marketSuggestion.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedByUserId: req.user!.id,
          reviewNotes: req.body.reviewNotes as string,
        },
      });

      await prisma.adminAuditLog.create({
        data: {
          userId: req.user!.id,
          action: "REJECT_SUGGESTION",
          targetType: "SUGGESTION",
          targetId: suggestion.id,
          metadata: { reviewNotes: req.body.reviewNotes },
        },
      });

      res.json({ suggestion: updated });
    } catch (err) {
      console.error("[admin/suggestions/reject]", err);
      res.status(500).json({ error: "Failed to reject suggestion" });
    }
  }
);

const confirmSchema = z.object({ confirm: z.literal(true) });

// POST /api/admin/suggestions/:id/create
// Creates the approved suggestion as an on-chain market.
// Requires confirm:true. Idempotency: rejects if already created, pending tx
// exists, or DB market exists. Waits for finality (once-per-market admin action).
router.post("/:id/create", requireAdmin, validate(confirmSchema), async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  try {
    const suggestion = await prisma.marketSuggestion.findUnique({
      where: { id },
      include: { market: true },
    });

    if (!suggestion) {
      res.status(404).json({ error: "Suggestion not found" });
      return;
    }

    // ── Idempotency guards ─────────────────────────────────────────────────
    if (suggestion.status !== "APPROVED") {
      res.status(409).json({
        error: `Suggestion must be APPROVED before creating on-chain. Current status: ${suggestion.status}`,
      });
      return;
    }

    if (suggestion.market) {
      res.status(409).json({
        error: "Market already exists for this suggestion",
        onChainMarketId: suggestion.market.onChainMarketId,
      });
      return;
    }

    if (!suggestion.resolutionUrl) {
      res.status(409).json({
        error: "Suggestion is missing resolutionUrl — cannot create market",
      });
      return;
    }

    // Generate a unique on-chain market ID (within 64-char contract limit)
    const onChainMarketId = `mkt-${suggestion.id.slice(0, 10)}-${Date.now()}`;

    // Check no successful prior create tx for this market ID
    const priorSuccess = await prisma.contractTransaction.findFirst({
      where: { onChainMarketId, txType: "CREATE_MARKET", executionResult: "SUCCESS" },
    });
    if (priorSuccess) {
      res.status(409).json({
        error: "A successful CREATE_MARKET tx already exists for this market ID",
        txHash: priorSuccess.txHash,
      });
      return;
    }
    // ──────────────────────────────────────────────────────────────────────

    const deadlineUnix = BigInt(
      Math.floor(suggestion.resolutionDeadline.getTime() / 1000)
    );

    if (deadlineUnix <= BigInt(Math.floor(Date.now() / 1000))) {
      res.status(409).json({
        error: "Suggestion deadline is in the past — cannot create market",
      });
      return;
    }

    const txHash = await createMarket({
      marketId: onChainMarketId,
      question: suggestion.question,
      yesCondition: suggestion.yesCondition,
      noCondition: suggestion.noCondition,
      invalidCondition: suggestion.invalidCondition,
      resolutionUrl: suggestion.resolutionUrl,
      resolutionQuery: suggestion.resolutionQuery,
      deadline: deadlineUnix,
    });

    // Record tx as PENDING
    await prisma.contractTransaction.create({
      data: {
        txHash,
        txType: "CREATE_MARKET",
        onChainMarketId,
        status: "PENDING",
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        userId: req.user!.id,
        action: "CREATE_MARKET_ON_CHAIN",
        targetType: "SUGGESTION",
        targetId: suggestion.id,
        metadata: { onChainMarketId, txHash },
      },
    });

    // Wait for finality — admin action, latency is acceptable
    console.log(`[admin/create-market] waiting for finality: ${txHash}`);
    const receipt = await waitForReceipt(txHash, 300);

    // Update ContractTransaction
    await prisma.contractTransaction.update({
      where: { txHash },
      data: {
        status: "FINALIZED",
        executionResult: receipt.executionResult ?? undefined,
        errorDescription: receipt.errorDescription ?? undefined,
      },
    });

    // Write contract event regardless of success/failure
    writeEventForTx({
      txHash,
      txType: "CREATE_MARKET",
      onChainMarketId,
      userAddress: null,
      valueWei: null,
      executionResult: receipt.executionResult,
      errorDescription: receipt.errorDescription ?? null,
    }).catch(err => console.error("[admin/create-market] event write error:", err));

    if (receipt.executionResult !== "SUCCESS") {
      res.status(422).json({
        error: "Contract rejected create_market",
        txHash,
        executionResult: receipt.executionResult,
        errorDescription: receipt.errorDescription,
      });
      return;
    }

    // Index the market in Postgres
    const market = await prisma.market.create({
      data: {
        suggestionId: suggestion.id,
        onChainMarketId,
        contractAddress: CONTRACT_ADDRESS,
        question: suggestion.question,
        category: suggestion.category,
        yesCondition: suggestion.yesCondition,
        noCondition: suggestion.noCondition,
        invalidCondition: suggestion.invalidCondition,
        resolutionUrl: suggestion.resolutionUrl ?? "",
        resolutionQuery: suggestion.resolutionQuery,
        resolutionDeadline: suggestion.resolutionDeadline,
        status: "OPEN",
        lastSyncedAt: new Date(),
      },
    });

    // Mark suggestion as CREATED
    await prisma.marketSuggestion.update({
      where: { id: suggestion.id },
      data: { status: "CREATED" },
    });

    res.status(201).json({ market, txHash, executionResult: "SUCCESS" });
  } catch (err) {
    console.error("[admin/suggestions/create]", err);
    res.status(500).json({ error: "Failed to create market on-chain" });
  }
});

export default router;
