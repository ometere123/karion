// api.ts — typed fetch wrapper for the Karion backend.
//
// All requests are made with credentials:"include" so the browser sends the
// session cookie automatically. The API base URL comes from
// NEXT_PUBLIC_API_URL (http://localhost:4000 in dev).
//
// Route map (confirmed from backend index.ts):
//   /auth/signup        POST
//   /auth/login         POST
//   /auth/logout        POST
//   /auth/me            GET
//   /api/markets        GET
//   /api/markets/:id    GET
//   /api/markets/:id/position        GET
//   /api/markets/:id/stake/yes       POST  { amountWei, confirm: true }
//   /api/markets/:id/stake/no        POST  { amountWei, confirm: true }
//   /api/markets/:id/claim           POST  { confirm: true }
//   /api/transactions/:txHash        GET
//   /api/portfolio                   GET
//   /api/suggestions                 POST / GET

import type {
  User,
  MarketDetailResponse,
  PositionResponse,
  TransactionResponse,
  PortfolioResponse,
  Market,
  Transaction,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// ── BigInt-safe GEN → wei conversion ─────────────────────────────────────────
//
// Converts a human-readable GEN string (e.g. "1.5") to a wei string
// (e.g. "1500000000000000000") using only BigInt arithmetic.
// No Number(), no parseFloat() for the final value.
//
// Rules:
//   - Max 18 decimal places (GEN has 18 decimals like ETH)
//   - Rejects negative, non-numeric, or > 18 decimal place inputs
//   - Returns null for invalid input
export function genToWei(genStr: string): string | null {
  const trimmed = genStr.trim();
  // Accept digits with an optional single decimal point
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  if (trimmed === "0" || trimmed === "0.0") return null;

  const parts = trimmed.split(".");
  const intPart = parts[0];
  const fracPart = parts[1] ?? "";

  if (fracPart.length > 18) return null;

  // Pad fractional part to exactly 18 digits
  const fracPadded = fracPart.padEnd(18, "0");

  // Combine: intPart * 10^18 + fracPadded (as integer)
  const wei = BigInt(intPart) * BigInt("1000000000000000000") + BigInt(fracPadded);

  if (wei === 0n) return null;
  return wei.toString();
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

class ApiResponseError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    const msg =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: string }).error)
        : `HTTP ${status}`;
    super(msg);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) throw new ApiResponseError(res.status, data);
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) =>
  request<T>("POST", path, body);

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface SignupResult {
  message: string;
  user: User;
  recoveryKey: string;
  recoveryKeyWarning: string;
}

export interface ResetPasswordResult {
  message: string;
  walletAutoRecovered: boolean;
  user?: User;
}

export const auth = {
  signup: (email: string, password: string, confirmPassword: string) =>
    post<SignupResult>("/auth/signup", { email, password, confirmPassword }),

  login: (email: string, password: string) =>
    post<{ message: string; user: User }>("/auth/login", { email, password }),

  logout: () => post<{ message: string }>("/auth/logout"),

  me: () => get<{ user: User }>("/auth/me"),

  forgotPassword: (email: string) =>
    post<{ message: string }>("/auth/forgot-password", { email }),

  resetPassword: (token: string, newPassword: string) =>
    post<ResetPasswordResult>("/auth/reset-password", { token, newPassword }),

  systemRecoveryStatus: () =>
    get<{ hasSystemRecovery: boolean; walletAddress: string; email: string }>(
      "/auth/system-recovery-status",
    ),
};

// ── Markets ───────────────────────────────────────────────────────────────────

export const markets = {
  list: () => get<{ markets: Market[] }>("/api/markets"),

  detail: (id: string) => get<MarketDetailResponse>(`/api/markets/${id}`),

  position: (id: string) => get<PositionResponse>(`/api/markets/${id}/position`),

  activity: (id: string) =>
    get<{ events: ContractEventRecord[] }>(`/api/markets/${id}/activity`),

  stakeYes: (id: string, amountWei: string) =>
    post<{ txHash: string; status: string; amountWei: string }>(
      `/api/markets/${id}/stake/yes`,
      { amountWei, confirm: true },
    ),

  stakeNo: (id: string, amountWei: string) =>
    post<{ txHash: string; status: string; amountWei: string }>(
      `/api/markets/${id}/stake/no`,
      { amountWei, confirm: true },
    ),

  claim: (id: string) =>
    post<{ txHash: string; status: string; txType: string; marketStatus: string }>(
      `/api/markets/${id}/claim`,
      { confirm: true },
    ),
};

// ── Transactions ──────────────────────────────────────────────────────────────

export const transactions = {
  get: (txHash: string) =>
    get<TransactionResponse>(`/api/transactions/${txHash}`),
};

// ── Portfolio ─────────────────────────────────────────────────────────────────

export const portfolio = {
  get: () => get<PortfolioResponse>("/api/portfolio"),
};

// ── Wallet ────────────────────────────────────────────────────────────────────

export interface WalletBalance {
  walletAddress: string;
  balanceWei: string;   // BigInt-safe decimal string — use for comparisons
  balanceGEN: string;   // display string only
  network: string;
  chainId: number;
  token: string;
}

export const wallet = {
  balance: () => get<WalletBalance>("/api/wallet/balance"),
};

// ── Suggestions ───────────────────────────────────────────────────────────────

export interface SuggestionPayload {
  question: string;
  category: string;
  yesCondition: string;
  noCondition: string;
  invalidCondition: string;
  resolutionUrl: string;
  resolutionQuery: string;
  resolutionDeadline: string; // ISO 8601
  sourcePolicy?: string;
  evidencePriority?: string;
}

export interface SuggestionRecord {
  id: string;
  question: string;
  category: string;
  status: string;
  resolutionDeadline: string;
  resolutionUrl: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  userId: string;
  relatedType: string | null;
  relatedId: string | null;
  fileUrl: string;
  fileKey: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
}

// ── Resolution Centre ────────────────────────────────────────────────────────

export interface MarketResolutionAttempt {
  id: string;
  marketId: string;
  triggeredBy: string | null;
  transactionHash: string | null;
  status: string;
  errorMessage: string | null;
  attemptedAt: string;
}

export interface ResolutionCentreMarket {
  id: string;
  onChainMarketId: string;
  question: string;
  category: string;
  status: string;
  resolutionDeadline: string;
  yesPoolCached: string;
  noPoolCached: string;
  totalPoolCached: string;
  finalOutcomeCached: string | null;
  confidence: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  lastSyncedAt: string | null;
  resolutionAttempts: Array<{
    id: string;
    status: string;
    transactionHash: string | null;
    triggeredBy: string | null;
    errorMessage: string | null;
    attemptedAt: string;
  }>;
}

export interface ResolutionCentreResponse {
  pastDeadline: ResolutionCentreMarket[];
  awaitingResolution: ResolutionCentreMarket[];
  recentlyResolved: ResolutionCentreMarket[];
  invalid: ResolutionCentreMarket[];
  unresolved: ResolutionCentreMarket[];
}

export const resolutionCentre = {
  list: () => get<ResolutionCentreResponse>("/api/resolution-centre"),
};

// ── Contract Events ───────────────────────────────────────────────────────────
// Activity records derived from finalized transactions.
// For history, audit, and UI timelines only — contract reads remain authoritative.

export interface ContractEventRecord {
  id: string;
  eventType: string;
  transactionHash: string;
  marketId: string | null;
  userAddress: string | null;
  valueWei: string | null;
  blockNumber: number | null;
  payloadJson: unknown;
  createdAt: string;
}

export const activity = {
  global: () => get<{ events: ContractEventRecord[] }>("/api/activity"),
};

export const suggestions = {
  submit: (payload: SuggestionPayload) =>
    post<{ suggestion: SuggestionRecord }>("/api/suggestions", payload),

  list: () => get<{ suggestions: SuggestionRecord[] }>("/api/suggestions"),

  getAttachments: (id: string) =>
    get<{ attachments: Attachment[] }>(`/api/suggestions/${id}/attachments`),

  saveAttachment: (
    id: string,
    data: { fileUrl: string; fileKey: string; fileType: string; fileSize: number },
  ) => post<{ attachment: Attachment }>(`/api/suggestions/${id}/attachments`, data),
};

// ── Admin ─────────────────────────────────────────────────────────────────────

export interface AdminSuggestion {
  id: string;
  question: string;
  category: string;
  status: string;
  resolutionUrl: string | null;
  resolutionDeadline: string;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
  suggestedBy: { id: string; email: string };
  reviewedBy: { id: string; email: string } | null;
  market: { onChainMarketId: string; status: string } | null;
}

export interface AdminMarket {
  id: string;
  onChainMarketId: string;
  question: string;
  category: string;
  status: string;
  resolutionDeadline: string;
  lastSyncedAt: string | null;
  createdAt: string;
  _count: { positions: number };
}

export interface AdminTransaction {
  id: string;
  txHash: string;
  txType: string;
  onChainMarketId: string | null;
  userAddress: string | null;
  valueWei: string | null;
  status: string;
  executionResult: string | null;
  errorDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncStatus {
  workerEnabled: boolean;
  totalMarkets: number;
  staleCount: number;
  staleMarkets: Array<{
    id: string;
    onChainMarketId: string;
    question: string;
    status: string;
    lastSyncedAt: string | null;
  }>;
  lastCheckedAt: string;
}

function buildQuery(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join("&");
  return q ? `?${q}` : "";
}

export const admin = {
  suggestions: {
    list: (status?: string) =>
      get<{ suggestions: AdminSuggestion[] }>(
        `/api/admin/suggestions${buildQuery({ status })}`,
      ),
    approve: (id: string, reviewNotes?: string) =>
      post<{ suggestion: AdminSuggestion }>(
        `/api/admin/suggestions/${id}/approve`,
        { reviewNotes },
      ),
    reject: (id: string, reviewNotes: string) =>
      post<{ suggestion: AdminSuggestion }>(
        `/api/admin/suggestions/${id}/reject`,
        { reviewNotes },
      ),
    create: (id: string) =>
      post<{ market: AdminMarket; txHash: string; executionResult: string }>(
        `/api/admin/suggestions/${id}/create`,
        { confirm: true },
      ),
  },

  markets: {
    list: (status?: string) =>
      get<{ markets: AdminMarket[] }>(
        `/api/admin/markets${buildQuery({ status })}`,
      ),
    lock: (id: string) =>
      post<{ txHash: string; executionResult: string; errorDescription: string | null }>(
        `/api/admin/markets/${id}/lock`,
        { confirm: true },
      ),
    resolve: (id: string) =>
      post<{ txHash: string; status: string; note: string }>(
        `/api/admin/markets/${id}/resolve`,
        { confirm: true },
      ),
    syncStatus: () => get<SyncStatus>("/api/admin/markets/sync-status"),
    resolveAttempts: (id: string) =>
      get<{ attempts: MarketResolutionAttempt[]; cooldownUntil: string | null }>(
        `/api/admin/markets/${id}/resolve-attempts`,
      ),
  },

  transactions: {
    list: (filters?: {
      status?: string;
      type?: string;
      userAddress?: string;
      marketId?: string;
    }) =>
      get<{ transactions: AdminTransaction[] }>(
        `/api/admin/markets/transactions${buildQuery(filters)}`,
      ),
  },

  activity: {
    list: (filters?: {
      eventType?: string;
      marketId?: string;
      userAddress?: string;
    }) =>
      get<{ events: ContractEventRecord[] }>(
        `/api/admin/activity${buildQuery(filters)}`,
      ),
  },
};

// Re-export error class for consumers that want to inspect status codes
export { ApiResponseError };
