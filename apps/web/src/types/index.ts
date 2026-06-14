// Karion shared types — mirrors the backend API response shapes.
// All wei amounts are strings (BigInt-serialised by the API).

export interface User {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  walletAddress: string;
  createdAt?: string; // ISO 8601 — present on /auth/me responses
}

// ── Markets ───────────────────────────────────────────────────────────────────

export type MarketStatus =
  | "OPEN"
  | "LOCKED"
  | "RESOLVING"
  | "RESOLVED"
  | "INVALID"
  | "UNRESOLVED"
  | "CANCELLED";

export type MarketOutcome = "YES" | "NO" | "" | null;
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "" | null;

// Postgres-cached market row (from GET /api/markets and GET /api/markets/:id)
export interface Market {
  id: string;
  onChainMarketId: string;
  contractAddress?: string;
  question: string;
  category: string;
  yesCondition?: string;
  noCondition?: string;
  invalidCondition?: string;
  resolutionUrl?: string;
  resolutionQuery?: string;
  status: MarketStatus;
  resolutionDeadline: string; // ISO 8601
  yesPoolCached: string;      // wei string
  noPoolCached: string;       // wei string
  totalPoolCached: string;    // wei string
  finalOutcomeCached: MarketOutcome;
  confidence: ConfidenceLevel;
  resolutionNote: string | null;
  resolvedAt: string | null;
  creatorAddress?: string | null;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

// Live contract read — from the onChain field in GET /api/markets/:id
// All numeric fields are BigInt-serialised strings by mapToObj on the backend.
export interface ContractMarket {
  question: string;
  yes_condition: string;
  no_condition: string;
  invalid_condition: string;
  resolution_url: string;
  resolution_query: string;
  deadline: string;   // unix timestamp, BigInt→string
  yes_pool: string;   // wei string
  no_pool: string;    // wei string
  status: MarketStatus;
  outcome: string;    // "YES" | "NO" | ""
  confidence: string; // "HIGH" | "MEDIUM" | "LOW" | ""
  resolution_note: string;
  resolved_at: string;
  creator: string;
}

export interface MarketDetailResponse {
  market: Market;
  onChain: ContractMarket | null;
}

// Live contract position — from GET /api/markets/:id/position
export interface ContractPosition {
  yes_stake: string; // wei string
  no_stake: string;  // wei string
  claimed: boolean;
}

export interface PositionResponse {
  position: ContractPosition;
  walletAddress: string;
}

// ── Transactions ──────────────────────────────────────────────────────────────

export type TxStatus = "PENDING" | "FINALIZED" | "ERROR";
export type TxExecutionResult = "SUCCESS" | "ERROR" | null;

export interface Transaction {
  id: string;
  txHash: string;
  txType: string;
  onChainMarketId: string;
  userAddress: string;
  valueWei: string | null;
  status: TxStatus;
  executionResult: TxExecutionResult;
  errorDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionResponse {
  transaction: Transaction;
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

export interface MarketPosition {
  id: string;
  userId: string;
  marketId: string;
  onChainMarketId: string;
  side: "YES" | "NO";
  amountGen: string; // cached wei string
  transactionHash: string;
  claimed: boolean;
  claimTransactionHash: string | null;
  createdAt: string;
  updatedAt: string;
  market: {
    onChainMarketId: string;
    question: string;
    category: string;
    status: MarketStatus;
    finalOutcomeCached: MarketOutcome;
    resolutionDeadline: string;
    yesPoolCached: string;
    noPoolCached: string;
    totalPoolCached: string;
    confidence: ConfidenceLevel;
    resolutionNote: string | null;
    resolvedAt: string | null;
  };
}

export interface PortfolioResponse {
  walletAddress: string;
  positions: MarketPosition[];
  note: string;
}

// ── Suggestions ───────────────────────────────────────────────────────────────

export type SuggestionStatus = "SUBMITTED" | "APPROVED" | "REJECTED" | "LIVE";

export interface Suggestion {
  id: string;
  question: string;
  category: string;
  yesCondition: string;
  noCondition: string;
  invalidCondition: string;
  resolutionUrl: string;
  resolutionQuery: string;
  resolutionDeadline: string;
  status: SuggestionStatus;
  createdAt: string;
}

// ── API error shape ───────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  errors?: Array<{ field: string; message: string }>;
}
