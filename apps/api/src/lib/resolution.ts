// resolution.ts
// Shared utilities for market resolution cooldown tracking.
// Imported by both the market-sync worker and admin resolve routes to enforce
// an identical retry-cooldown gate across all resolve code paths.
//
// Cooldown window: RESOLVE_RETRY_COOLDOWN_MS env var (default 10 minutes).
// A market is "in cooldown" when its most recent FAILED MarketResolutionAttempt
// was created within the cooldown window.

import { prisma } from "./prisma.js";

export const RESOLVE_RETRY_COOLDOWN_MS = parseInt(
  process.env.RESOLVE_RETRY_COOLDOWN_MS || "600000",
  10,
);

// Returns the cooldown expiry Date if the market has a recent failed attempt,
// null if the market is not in cooldown and a resolve may be attempted.
// marketId must be the internal DB id (not onChainMarketId).
export async function getResolveCooldown(marketId: string): Promise<Date | null> {
  const cooldownCutoff = new Date(Date.now() - RESOLVE_RETRY_COOLDOWN_MS);
  const lastFailed = await prisma.marketResolutionAttempt.findFirst({
    where: {
      marketId,
      status: "FAILED",
      attemptedAt: { gt: cooldownCutoff },
    },
    orderBy: { attemptedAt: "desc" },
  });
  if (!lastFailed) return null;
  return new Date(lastFailed.attemptedAt.getTime() + RESOLVE_RETRY_COOLDOWN_MS);
}
