// POSTGRES IS CACHE ONLY for position data.
// This route aggregates cached position data for display only.
// For authoritative stake amounts and claimed state, use GET /markets/:id/position
// which reads directly from the contract.

import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// GET /api/portfolio — all positions for the authenticated user
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const positions = await prisma.marketPosition.findMany({
      where: { userId: req.user!.id },
      include: {
        market: {
          select: {
            onChainMarketId: true,
            question: true,
            category: true,
            status: true,
            finalOutcomeCached: true,
            resolutionDeadline: true,
            yesPoolCached: true,
            noPoolCached: true,
            totalPoolCached: true,
            confidence: true,
            resolutionNote: true,
            resolvedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      walletAddress: req.walletAddress,
      positions,
      note: "amountGen and claimed are cached. For authoritative values call GET /markets/:id/position",
    });
  } catch (err) {
    console.error("[portfolio]", err);
    res.status(500).json({ error: "Failed to fetch portfolio" });
  }
});

export default router;
