// resolution-centre.ts
// GET /api/resolution-centre — markets grouped by resolution state.
//
// Returns DB-cached market data for display purposes. Contract state is
// authoritative for all financial decisions; these values are synced by
// the market-sync worker and should not be used for claim eligibility.
//
// Authenticated (requireAuth): v1 includes claim context and tx links.

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

const RECENTLY_RESOLVED_DAYS = 30;

const attemptSelect = {
  id: true,
  status: true,
  transactionHash: true,
  triggeredBy: true,
  errorMessage: true,
  attemptedAt: true,
} as const;

const marketSelect = {
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
  resolutionNote: true,
  resolvedAt: true,
  lastSyncedAt: true,
  resolutionAttempts: {
    select: attemptSelect,
    orderBy: { attemptedAt: "desc" as const },
    take: 1,
  },
} as const;

// GET /api/resolution-centre
router.get("/", requireAuth, async (_req, res) => {
  try {
    const now = new Date();
    const recentCutoff = new Date(
      now.getTime() - RECENTLY_RESOLVED_DAYS * 24 * 60 * 60 * 1000,
    );

    const [pastDeadline, awaitingResolution, recentlyResolved, invalid, unresolved] =
      await Promise.all([
        // OPEN markets whose deadline has passed — eligible for resolve
        prisma.market.findMany({
          where: { status: "OPEN", resolutionDeadline: { lt: now } },
          select: marketSelect,
          orderBy: { resolutionDeadline: "asc" },
          take: 50,
        }),

        // LOCKED or RESOLVING — awaiting GenLayer consensus
        prisma.market.findMany({
          where: { status: { in: ["LOCKED", "RESOLVING"] as any[] } },
          select: marketSelect,
          orderBy: { resolutionDeadline: "asc" },
          take: 50,
        }),

        // RESOLVED within the last 30 days
        prisma.market.findMany({
          where: { status: "RESOLVED", resolvedAt: { gte: recentCutoff } },
          select: marketSelect,
          orderBy: { resolvedAt: "desc" },
          take: 50,
        }),

        // INVALID markets
        prisma.market.findMany({
          where: { status: "INVALID" },
          select: marketSelect,
          orderBy: { resolvedAt: "desc" },
          take: 50,
        }),

        // UNRESOLVED markets
        prisma.market.findMany({
          where: { status: "UNRESOLVED" },
          select: marketSelect,
          orderBy: { resolvedAt: "desc" },
          take: 50,
        }),
      ]);

    res.json({
      pastDeadline,
      awaitingResolution,
      recentlyResolved,
      invalid,
      unresolved,
    });
  } catch (err) {
    console.error("[resolution-centre]", err);
    res.status(500).json({ error: "Failed to fetch resolution centre data" });
  }
});

export default router;
