// market-sync.ts
// Periodic background worker that syncs KarionMarket contract state → Postgres.
//
// Only starts when ENABLE_MARKET_SYNC=true (never auto-started in tests or scripts).
//
// What it does on each cycle (every SYNC_INTERVAL_MS):
//   1. Read all non-terminal markets from DB
//   2. For each: call get_market() on-chain, update cached fields
//   3. Auto-trigger resolve_market() for markets past deadline (with guards)
//   4. Poll PENDING ContractTransaction rows older than 30s for receipt status
//
// POSTGRES IS CACHE ONLY — this worker updates the cache.
// The contract remains authoritative for all financial state.

import { prisma } from "../lib/prisma.js";
import {
  getMarket,
  resolveMarket,
  pollReceiptOnce,
} from "../lib/contract.js";
import { writeEventForTx } from "../lib/events.js";
import { getResolveCooldown } from "../lib/resolution.js";

const SYNC_INTERVAL_MS = parseInt(
  process.env.SYNC_INTERVAL_MS || "60000",
  10,
);

const TERMINAL_STATUSES = ["RESOLVED", "INVALID", "UNRESOLVED", "CANCELLED"];

// Maps contract status strings to DB MarketStatus enum values.
function contractStatusToDb(
  s: string,
): "OPEN" | "LOCKED" | "RESOLVED" | "INVALID" | "UNRESOLVED" | "CANCELLED" {
  const map: Record<string, string> = {
    OPEN: "OPEN",
    LOCKED: "LOCKED",
    RESOLVED: "RESOLVED",
    INVALID: "INVALID",
    UNRESOLVED: "UNRESOLVED",
    CANCELLED: "CANCELLED",
  };
  return (map[s] ?? "OPEN") as ReturnType<typeof contractStatusToDb>;
}

async function syncMarket(onChainMarketId: string, dbId: string): Promise<void> {
  let onChain: Awaited<ReturnType<typeof getMarket>>;
  try {
    onChain = await getMarket(onChainMarketId);
  } catch (err) {
    console.error(`[market-sync] get_market failed for ${onChainMarketId}:`, err);
    return;
  }

  const newStatus = contractStatusToDb(onChain.status);
  const resolvedAt = onChain.resolved_at ? new Date(onChain.resolved_at) : null;

  await prisma.market.update({
    where: { id: dbId },
    data: {
      status: newStatus,
      yesPoolCached: String(onChain.yes_pool),
      noPoolCached: String(onChain.no_pool),
      totalPoolCached: String(BigInt(onChain.yes_pool) + BigInt(onChain.no_pool)),
      finalOutcomeCached:
        onChain.outcome === "YES"
          ? "YES"
          : onChain.outcome === "NO"
          ? "NO"
          : onChain.status === "INVALID"
          ? "INVALID"
          : onChain.status === "UNRESOLVED"
          ? "UNRESOLVED"
          : null,
      confidence: onChain.confidence || null,
      resolutionNote: onChain.resolution_note || null,
      resolvedAt,
      lastSyncedAt: new Date(),
    },
  });

  // Auto-resolve eligibility
  const nowSec = Math.floor(Date.now() / 1000);
  const isEligibleForResolve =
    (onChain.status === "OPEN" && onChain.deadline < nowSec) ||
    onChain.status === "LOCKED";

  if (!isEligibleForResolve) return;

  // Guard 1: no pending resolve tx already in-flight
  const pendingResolve = await prisma.contractTransaction.findFirst({
    where: { onChainMarketId, txType: "RESOLVE_MARKET", status: "PENDING" },
  });
  if (pendingResolve) return;

  // Guard 2: no successful resolve tx already exists
  const successfulResolve = await prisma.contractTransaction.findFirst({
    where: { onChainMarketId, txType: "RESOLVE_MARKET", executionResult: "SUCCESS" },
  });
  if (successfulResolve) return;

  // Guard 3: retry cooldown — skip if last failed attempt is still within window
  const cooldownUntil = await getResolveCooldown(dbId);
  if (cooldownUntil) {
    console.log(
      `[market-sync] ${onChainMarketId} in resolve cooldown until ${cooldownUntil.toISOString()}`,
    );
    return;
  }

  console.log(`[market-sync] auto-resolving market: ${onChainMarketId}`);

  // Record the attempt before submitting so cooldown triggers even if tx submission throws
  const attempt = await prisma.marketResolutionAttempt.create({
    data: {
      marketId: dbId,
      triggeredBy: "WORKER",
      status: "PENDING",
    },
  });

  try {
    const txHash = await resolveMarket(onChainMarketId);

    // Attach txHash to the attempt now that we have it
    await prisma.marketResolutionAttempt.update({
      where: { id: attempt.id },
      data: { transactionHash: txHash },
    });

    await prisma.contractTransaction.create({
      data: {
        txHash,
        txType: "RESOLVE_MARKET",
        onChainMarketId,
        status: "PENDING",
      },
    });

    await prisma.market.update({
      where: { id: dbId },
      data: { status: "RESOLVING" },
    });

    await prisma.adminAuditLog.create({
      data: {
        userId: null, // system-triggered
        action: "AUTO_RESOLVE",
        targetType: "MARKET",
        targetId: dbId,
        metadata: { onChainMarketId, txHash },
      },
    });

    console.log(`[market-sync] resolve_market submitted: ${txHash}`);
  } catch (err) {
    console.error(
      `[market-sync] resolve_market failed for ${onChainMarketId}:`,
      err,
    );
    // Mark FAILED immediately so cooldown starts now
    await prisma.marketResolutionAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

async function pollPendingTransactions(): Promise<void> {
  const pending = await prisma.contractTransaction.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: new Date(Date.now() - 30_000) },
    },
    take: 20,
    orderBy: { createdAt: "asc" },
  });

  for (const tx of pending) {
    try {
      const outcome = await pollReceiptOnce(tx.txHash);
      if (!outcome) continue; // still pending

      await prisma.contractTransaction.update({
        where: { id: tx.id },
        data: {
          status: "FINALIZED",
          executionResult: outcome.executionResult ?? undefined,
          errorDescription: outcome.errorDescription ?? undefined,
        },
      });

      console.log(
        `[market-sync] tx finalised: ${tx.txHash} (${tx.txType}) → ${outcome.executionResult}`,
      );

      // Update matching MarketResolutionAttempt to SUCCESS or FAILED
      if (tx.txType === "RESOLVE_MARKET" && tx.onChainMarketId) {
        const dbMarket = await prisma.market.findUnique({
          where: { onChainMarketId: tx.onChainMarketId },
          select: { id: true },
        });
        if (dbMarket) {
          const attempt = await prisma.marketResolutionAttempt.findFirst({
            where: {
              marketId: dbMarket.id,
              transactionHash: tx.txHash,
              status: "PENDING",
            },
          });
          if (attempt) {
            await prisma.marketResolutionAttempt.update({
              where: { id: attempt.id },
              data: {
                status: outcome.executionResult === "SUCCESS" ? "SUCCESS" : "FAILED",
                errorMessage:
                  outcome.executionResult === "ERROR"
                    ? (outcome.errorDescription ?? "Unknown error")
                    : null,
              },
            });
          }
        }
      }

      // If resolve tx succeeded: re-sync from contract for fresh outcome/confidence
      if (
        tx.txType === "RESOLVE_MARKET" &&
        outcome.executionResult === "SUCCESS" &&
        tx.onChainMarketId
      ) {
        const dbMarket = await prisma.market.findUnique({
          where: { onChainMarketId: tx.onChainMarketId },
        });
        if (dbMarket) {
          await syncMarket(tx.onChainMarketId, dbMarket.id);
        }
      }

      // If resolve tx failed: revert DB status from RESOLVING → LOCKED
      if (
        tx.txType === "RESOLVE_MARKET" &&
        outcome.executionResult === "ERROR" &&
        tx.onChainMarketId
      ) {
        await prisma.market.updateMany({
          where: { onChainMarketId: tx.onChainMarketId, status: "RESOLVING" },
          data: { status: "LOCKED" },
        });
      }

      // Write ContractEvent — idempotent via @@unique([transactionHash, eventType])
      // For RESOLVE_MARKET SUCCESS: writeEventForTx calls getMarket() for fresh outcome
      writeEventForTx({
        txHash: tx.txHash,
        txType: tx.txType,
        onChainMarketId: tx.onChainMarketId,
        userAddress: tx.userAddress,
        valueWei: tx.valueWei,
        executionResult: outcome.executionResult,
        errorDescription: outcome.errorDescription,
      }).catch(err =>
        console.error(`[market-sync] event write error for ${tx.txHash}:`, err),
      );
    } catch (err) {
      // Swallow per-tx errors — log and continue with remaining txs
      console.error(`[market-sync] pollReceiptOnce error for ${tx.txHash}:`, err);
    }
  }
}

async function runSyncCycle(): Promise<void> {
  try {
    const markets = await prisma.market.findMany({
      where: { status: { notIn: TERMINAL_STATUSES as any[] } },
      select: { id: true, onChainMarketId: true },
    });

    for (const market of markets) {
      await syncMarket(market.onChainMarketId, market.id);
    }

    await pollPendingTransactions();
  } catch (err) {
    console.error("[market-sync] cycle error:", err);
  }
}

export function startMarketSyncWorker(): void {
  if (process.env.ENABLE_MARKET_SYNC !== "true") {
    console.log("[market-sync] disabled (ENABLE_MARKET_SYNC is not true)");
    return;
  }

  console.log(
    `[market-sync] starting — interval ${SYNC_INTERVAL_MS / 1000}s`,
  );

  runSyncCycle();
  setInterval(runSyncCycle, SYNC_INTERVAL_MS);
}
