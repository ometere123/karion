// activity.ts
// Global activity feed — recent ContractEvent rows across all markets.
// History and audit only. Contract reads remain authoritative.

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// GET /api/activity — recent events across all markets (authenticated users)
router.get("/", requireAuth, async (_req, res) => {
  try {
    const events = await prisma.contractEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ events });
  } catch (err) {
    console.error("[activity/global]", err);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

export default router;
