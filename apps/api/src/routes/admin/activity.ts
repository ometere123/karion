// admin/activity.ts
// Full admin event feed with filters.
// History and audit only — contract reads remain authoritative.

import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";

const router = Router();

// GET /api/admin/activity
// Filters: eventType, marketId (onChainMarketId), userAddress
router.get("/", requireAdmin, async (req, res) => {
  const eventType = req.query.eventType as string | undefined;
  const onChainMarketId = req.query.marketId as string | undefined;
  const userAddress = req.query.userAddress as string | undefined;

  try {
    let marketId: string | undefined;
    if (onChainMarketId) {
      const market = await prisma.market.findUnique({
        where: { onChainMarketId },
        select: { id: true },
      });
      marketId = market?.id;
    }

    const events = await prisma.contractEvent.findMany({
      where: {
        ...(eventType ? { eventType } : {}),
        ...(marketId ? { marketId } : {}),
        ...(userAddress
          ? { userAddress: { contains: userAddress, mode: "insensitive" } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    res.json({ events });
  } catch (err) {
    console.error("[admin/activity]", err);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

export default router;
