/**
 * backfill-events.mjs
 *
 * One-time backfill: creates ContractEvent rows for any FINALIZED
 * ContractTransaction that doesn't already have a corresponding event.
 *
 * Safe to run multiple times — writeEventForTx is idempotent via the
 * @@unique([transactionHash, eventType]) compound key on ContractEvent.
 *
 * Usage:
 *   node scripts/backfill-events.mjs
 *
 * Requires the API's .env (DATABASE_URL, GENLAYER_CONTRACT_ADDRESS, etc.)
 * to be set, or run from inside the apps/api directory where dotenv picks
 * up .env automatically.
 */

import { config } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the API .env (one level up from scripts, then into apps/api)
config({ path: join(__dirname, "../apps/api/.env") });

// Dynamic import so env vars are loaded before Prisma initialises
const { PrismaClient } = await import("@prisma/client");

// Build a minimal writeEventForTx that mirrors the production helper
// without needing to transpile the full TypeScript source.
const prisma = new PrismaClient();

async function writeContractEvent(params) {
  try {
    await prisma.contractEvent.create({
      data: {
        transactionHash: params.transactionHash,
        eventType: params.eventType,
        marketId: params.marketId ?? null,
        userAddress: params.userAddress ?? null,
        valueWei: params.valueWei ?? null,
        payloadJson: params.payloadJson ?? undefined,
      },
    });
    return "created";
  } catch (err) {
    if (err?.code === "P2002") return "duplicate";
    throw err;
  }
}

async function resolveMarketId(onChainMarketId) {
  if (!onChainMarketId) return null;
  const m = await prisma.market.findUnique({
    where: { onChainMarketId },
    select: { id: true },
  });
  return m?.id ?? null;
}

const SUCCESS_MAP = {
  CREATE_MARKET: "MARKET_CREATED",
  STAKE_YES: "STAKE_YES",
  STAKE_NO: "STAKE_NO",
  LOCK_MARKET: "MARKET_LOCKED",
  RESOLVE_MARKET: "MARKET_RESOLVED", // approximation for backfill; live outcome needs RPC
  CLAIM_PAYOUT: "CLAIM_PAYOUT",
  CLAIM_REFUND: "CLAIM_REFUND",
};

async function backfill() {
  console.log("=== Stage F backfill: FINALIZED ContractTransaction → ContractEvent ===\n");

  const txs = await prisma.contractTransaction.findMany({
    where: { status: "FINALIZED" },
    orderBy: { createdAt: "asc" },
  });

  if (txs.length === 0) {
    console.log("No FINALIZED transactions found — nothing to backfill.");
    return;
  }

  console.log(`Found ${txs.length} FINALIZED transaction(s):\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const tx of txs) {
    const marketId = await resolveMarketId(tx.onChainMarketId);

    let eventType;
    let payloadJson = null;

    if (tx.executionResult !== "SUCCESS") {
      eventType = "TX_FAILED";
      payloadJson = {
        txType: tx.txType,
        executionResult: tx.executionResult,
        errorDescription: tx.errorDescription ?? null,
      };
    } else {
      eventType = SUCCESS_MAP[tx.txType] ?? "TX_FAILED";
    }

    const result = await writeContractEvent({
      transactionHash: tx.txHash,
      eventType,
      marketId,
      userAddress: tx.userAddress,
      valueWei: tx.valueWei,
      payloadJson,
    });

    const status = result === "created" ? "✓" : "~";
    console.log(`  ${status} ${tx.txType.padEnd(16)} ${tx.txHash.slice(0, 12)}… → ${eventType} [${result}]`);

    if (result === "created") created++;
    else skipped++;
  }

  console.log(`\nDone: ${created} created, ${skipped} already existed (idempotent), ${failed} failed.`);
}

try {
  await backfill();
} finally {
  await prisma.$disconnect();
}
