// events.ts
// Idempotent writer for ContractEvent rows.
//
// Events are derived from ContractTransaction records at the moment a tx
// becomes FINALIZED. They are for history, audit, and UI timelines only.
// Contract reads remain the sole source of truth for financial state.
//
// Idempotency: @@unique([transactionHash, eventType]) on ContractEvent.
// Duplicate writes swallow Prisma P2002 and return silently.

import { prisma } from "./prisma.js";
import { getMarket } from "./contract.js";

export interface WriteEventParams {
  transactionHash: string;
  eventType: string;
  marketId?: string | null;
  userAddress?: string | null;
  valueWei?: string | null;
  payloadJson?: Record<string, unknown> | null;
}

export async function writeContractEvent(params: WriteEventParams): Promise<void> {
  try {
    await prisma.contractEvent.create({
      data: {
        transactionHash: params.transactionHash,
        eventType: params.eventType,
        marketId: params.marketId ?? null,
        userAddress: params.userAddress ?? null,
        valueWei: params.valueWei ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payloadJson: (params.payloadJson ?? undefined) as any,
      },
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return; // (txHash, eventType) already indexed — idempotent
    throw err;
  }
}

// Maps a finalized ContractTransaction to a ContractEvent.
// For RESOLVE_MARKET SUCCESS, reads fresh on-chain state to determine outcome.
// Call this once per tx, from any finality path.
export async function writeEventForTx(tx: {
  txHash: string;
  txType: string;
  onChainMarketId: string | null;
  userAddress: string | null;
  valueWei: string | null;
  executionResult: string | null;
  errorDescription: string | null;
}): Promise<void> {
  // Resolve internal DB marketId
  let marketId: string | null = null;
  if (tx.onChainMarketId) {
    const dbMarket = await prisma.market.findUnique({
      where: { onChainMarketId: tx.onChainMarketId },
      select: { id: true },
    });
    marketId = dbMarket?.id ?? null;
  }

  let eventType: string;
  let payloadJson: Record<string, unknown> | null = null;

  if (tx.executionResult !== "SUCCESS") {
    // Failed transaction — always TX_FAILED regardless of txType
    eventType = "TX_FAILED";
    payloadJson = {
      txType: tx.txType,
      executionResult: tx.executionResult,
      errorDescription: tx.errorDescription ?? null,
    };
  } else if (tx.txType === "RESOLVE_MARKET" && tx.onChainMarketId) {
    // Fresh on-chain read required — receipt alone doesn't expose outcome
    let onChainStatus = "RESOLVED";
    let outcome: string | null = null;
    let confidence: string | null = null;
    let resolutionNote: string | null = null;
    try {
      const onChain = await getMarket(tx.onChainMarketId);
      onChainStatus = onChain.status;
      outcome = onChain.outcome || null;
      confidence = onChain.confidence || null;
      resolutionNote = onChain.resolution_note || null;
    } catch (err) {
      console.error(`[events] getMarket failed for resolve event ${tx.txHash}:`, err);
    }
    const resolveMap: Record<string, string> = {
      RESOLVED: "MARKET_RESOLVED",
      INVALID: "MARKET_INVALID",
      UNRESOLVED: "MARKET_UNRESOLVED",
    };
    eventType = resolveMap[onChainStatus] ?? "MARKET_RESOLVED";
    payloadJson = { outcome, confidence, resolutionNote, onChainStatus };
  } else {
    const successMap: Record<string, string> = {
      CREATE_MARKET: "MARKET_CREATED",
      STAKE_YES: "STAKE_YES",
      STAKE_NO: "STAKE_NO",
      LOCK_MARKET: "MARKET_LOCKED",
      CLAIM_PAYOUT: "CLAIM_PAYOUT",
      CLAIM_REFUND: "CLAIM_REFUND",
    };
    eventType = successMap[tx.txType] ?? "TX_FAILED";
  }

  await writeContractEvent({
    transactionHash: tx.txHash,
    eventType,
    marketId,
    userAddress: tx.userAddress,
    valueWei: tx.valueWei,
    payloadJson,
  });
}
