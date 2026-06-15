"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { admin, ApiResponseError } from "@/lib/api";
import type { AdminMarket, SyncStatus, MarketResolutionAttempt } from "@/lib/api";
import { cn } from "@/lib/utils";
import TxLink from "@/components/TxLink";

const STATUS_COLORS: Record<string, string> = {
  OPEN: "text-green bg-verdict-green/10 border-verdict-green/30",
  LOCKED: "text-amber bg-market-amber/10 border-market-amber/30",
  RESOLVING: "text-violet bg-violet/10 border-violet/30",
  RESOLVED: "text-frost bg-graphite border-steel",
  INVALID: "text-red bg-liquid-red/10 border-liquid-red/30",
  UNRESOLVED: "text-muted bg-graphite border-steel",
  CANCELLED: "text-red bg-liquid-red/10 border-liquid-red/30",
};

const ATTEMPT_COLORS: Record<string, string> = {
  SUCCESS: "text-green border-verdict-green/30 bg-verdict-green/10",
  FAILED: "text-red border-liquid-red/30 bg-liquid-red/10",
  PENDING: "text-violet border-violet/30 bg-violet/10",
};

type ConfirmState =
  | { type: "lock"; marketId: string; question: string }
  | { type: "resolve"; marketId: string; question: string };

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-md border px-2 py-0.5 font-data text-xs",
        STATUS_COLORS[status] ?? "text-muted bg-graphite border-steel",
      )}
    >
      {status}
    </span>
  );
}

function SyncPanel({ sync }: { sync: SyncStatus | null }) {
  if (!sync) return null;
  return (
    <div className="mb-6 rounded-xl border border-steel bg-obsidian px-5 py-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted">Sync worker</span>
          <span
            className={cn(
              "rounded-md border px-2 py-0.5 font-data text-xs",
              sync.workerEnabled
                ? "border-verdict-green/30 bg-verdict-green/10 text-green"
                : "border-steel bg-graphite text-muted",
            )}
          >
            {sync.workerEnabled ? "ENABLED" : "DISABLED"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted">Total markets</span>
          <span className="font-data text-frost">{sync.totalMarkets}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted">Stale active markets</span>
          <span className={cn("font-data", sync.staleCount > 0 ? "text-amber" : "text-green")}>
            {sync.staleCount}
          </span>
        </div>
        <div className="ml-auto text-xs text-muted">
          Checked {new Date(sync.lastCheckedAt).toLocaleTimeString()}
        </div>
      </div>
      {sync.staleCount > 0 && (
        <div className="mt-3 space-y-1.5">
          {sync.staleMarkets.slice(0, 5).map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-lg border border-market-amber/20 bg-market-amber/5 px-3 py-2 text-xs"
            >
              <StatusBadge status={m.status} />
              <span className="truncate text-muted">{m.question}</span>
              <span className="ml-auto shrink-0 text-muted">
                {m.lastSyncedAt
                  ? `Last sync ${new Date(m.lastSyncedAt).toLocaleTimeString()}`
                  : "Never synced"}
              </span>
            </div>
          ))}
          {sync.staleCount > 5 && (
            <p className="px-1 text-xs text-muted">+{sync.staleCount - 5} more stale markets</p>
          )}
        </div>
      )}
    </div>
  );
}

interface AttemptsData {
  attempts: MarketResolutionAttempt[];
  cooldownUntil: string | null;
}

function AttemptsPanel({ data, loading }: { data: AttemptsData | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-1.5">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-graphite/60" />
        ))}
      </div>
    );
  }
  if (!data) {
    return <p className="text-xs text-red">Failed to load attempts</p>;
  }

  return (
    <div className="space-y-3">
      {data.cooldownUntil && (
        <div className="rounded-lg border border-market-amber/30 bg-market-amber/10 px-3 py-2 text-xs text-amber">
          Cooldown active — retry available at{" "}
          <span className="font-data">{new Date(data.cooldownUntil).toLocaleTimeString()}</span>
        </div>
      )}
      {data.attempts.length === 0 ? (
        <p className="text-xs text-muted">No resolve attempts recorded for this market</p>
      ) : (
        <div className="space-y-1.5">
          {data.attempts.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-steel bg-graphite/40 px-3 py-2"
            >
              <span
                className={cn(
                  "rounded-md border px-1.5 py-0.5 font-data text-xs",
                  ATTEMPT_COLORS[a.status] ?? "text-muted border-steel bg-graphite",
                )}
              >
                {a.status}
              </span>
              <span className="text-xs text-muted">
                {a.triggeredBy === "WORKER" ? "Auto (worker)" : "Admin"}
              </span>
              {a.transactionHash && (
                <TxLink hash={a.transactionHash} />
              )}
              {a.errorMessage && (
                <span className="truncate max-w-xs text-xs text-red">{a.errorMessage}</span>
              )}
              <span className="ml-auto shrink-0 text-xs text-muted">
                {new Date(a.attemptedAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminMarketsPage() {
  const [markets, setMarkets] = useState<AdminMarket[]>([]);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Resolve attempts panel
  const [attemptsMarketId, setAttemptsMarketId] = useState<string | null>(null);
  const [attemptsData, setAttemptsData] = useState<AttemptsData | null>(null);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mktsRes, syncRes] = await Promise.all([
        admin.markets.list(filter === "ALL" ? undefined : filter),
        admin.markets.syncStatus(),
      ]);
      setMarkets(mktsRes.markets);
      setSync(syncRes);
    } catch {
      setError("Failed to load markets");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleAttempts(onChainMarketId: string) {
    if (attemptsMarketId === onChainMarketId) {
      setAttemptsMarketId(null);
      setAttemptsData(null);
      return;
    }
    setAttemptsMarketId(onChainMarketId);
    setAttemptsData(null);
    setAttemptsLoading(true);
    try {
      const res = await admin.markets.resolveAttempts(onChainMarketId);
      setAttemptsData(res);
    } catch {
      setAttemptsData(null);
    } finally {
      setAttemptsLoading(false);
    }
  }

  async function handleLock() {
    if (confirm?.type !== "lock") return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await admin.markets.lock(confirm.marketId);
      if (res.executionResult === "SUCCESS") {
        setActionSuccess(`Market locked: ${confirm.marketId}`);
      } else {
        setActionError(
          `Lock failed on-chain: ${res.errorDescription ?? res.executionResult}`,
        );
      }
      setConfirm(null);
      load();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Lock failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolve() {
    if (confirm?.type !== "resolve") return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await admin.markets.resolve(confirm.marketId);
      setActionSuccess(
        `Resolve triggered for ${confirm.marketId}. Tx: ${res.txHash.slice(0, 10)}…`,
      );
      setConfirm(null);
      load();
    } catch (e: unknown) {
      if (e instanceof ApiResponseError) {
        const body = e.body as Record<string, unknown>;
        if (body?.cooldownUntil) {
          const until = new Date(String(body.cooldownUntil));
          setActionError(
            `${e.message} Retry available at ${until.toLocaleTimeString()}.`,
          );
        } else {
          setActionError(e.message);
        }
      } else {
        setActionError(e instanceof Error ? e.message : "Resolve trigger failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const STATUS_OPTS = ["ALL", "OPEN", "LOCKED", "RESOLVING", "RESOLVED", "INVALID"];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-frost">Markets</h1>
        <div className="flex gap-2">
          <Link
            href="/admin/markets/create"
            className="rounded-lg bg-violet px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            + Create Market
          </Link>
          <button
            onClick={load}
            className="rounded-lg border border-steel bg-graphite px-3 py-1.5 text-xs text-muted hover:text-frost transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      <SyncPanel sync={sync} />

      {actionSuccess && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-verdict-green/30 bg-verdict-green/10 px-4 py-3">
          <span className="text-sm text-green">{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="text-xs text-muted hover:text-frost">✕</button>
        </div>
      )}
      {actionError && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-liquid-red/30 bg-liquid-red/10 px-4 py-3">
          <span className="text-sm text-red">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-xs text-muted hover:text-frost">✕</button>
        </div>
      )}

      {/* Status filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_OPTS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === s
                ? "border-violet bg-violet/10 text-violet"
                : "border-steel bg-graphite text-muted hover:text-frost",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-graphite" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-red">{error}</p>
      ) : markets.length === 0 ? (
        <div className="rounded-xl border border-steel bg-obsidian px-6 py-12 text-center">
          <p className="text-sm text-muted">No markets found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {markets.map((m) => {
            const isConfirming = confirm?.marketId === m.onChainMarketId;
            const isAttemptsOpen = attemptsMarketId === m.onChainMarketId;
            const deadline = new Date(m.resolutionDeadline);
            const isPast = deadline < new Date();

            return (
              <div key={m.id} className="rounded-xl border border-steel bg-obsidian">
                <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={m.status} />
                      <span className="font-data text-xs text-muted">{m.onChainMarketId}</span>
                      <span className="text-xs text-steel">·</span>
                      <span className="text-xs text-muted">{m._count.positions} positions</span>
                      <span className="text-xs text-steel">·</span>
                      <span className={cn("text-xs", isPast ? "text-red" : "text-muted")}>
                        Deadline {deadline.toLocaleDateString()}{isPast ? " (past)" : ""}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm text-frost">{m.question}</p>
                    <p className="mt-1 text-xs text-muted">
                      {m.lastSyncedAt
                        ? `Synced ${new Date(m.lastSyncedAt).toLocaleTimeString()}`
                        : "Never synced"}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {/* Attempts toggle */}
                    <button
                      onClick={() => toggleAttempts(m.onChainMarketId)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        isAttemptsOpen
                          ? "border-violet/40 bg-violet/10 text-violet"
                          : "border-steel bg-graphite text-muted hover:text-frost",
                      )}
                    >
                      Attempts
                    </button>

                    {m.status === "OPEN" && (
                      <button
                        onClick={() =>
                          setConfirm(
                            isConfirming && confirm.type === "lock"
                              ? null
                              : { type: "lock", marketId: m.onChainMarketId, question: m.question },
                          )
                        }
                        className="rounded-lg border border-market-amber/30 bg-market-amber/10 px-3 py-1.5 text-xs font-medium text-amber transition-colors hover:bg-market-amber/20"
                      >
                        Lock
                      </button>
                    )}
                    {m.status === "LOCKED" && (
                      <button
                        onClick={() =>
                          setConfirm(
                            isConfirming && confirm.type === "resolve"
                              ? null
                              : { type: "resolve", marketId: m.onChainMarketId, question: m.question },
                          )
                        }
                        className="rounded-lg border border-violet/30 bg-violet/10 px-3 py-1.5 text-xs font-medium text-violet transition-colors hover:bg-violet/20"
                      >
                        Trigger Resolve
                      </button>
                    )}
                    {m.status === "RESOLVING" && (
                      <span className="rounded-lg border border-violet/20 px-3 py-1.5 text-xs text-violet">
                        Resolving…
                      </span>
                    )}
                  </div>
                </div>

                {/* Resolve attempts panel */}
                {isAttemptsOpen && (
                  <div className="border-t border-steel px-5 py-4">
                    <p className="mb-3 text-xs font-semibold text-muted uppercase tracking-wide">
                      Resolve Attempts
                    </p>
                    <AttemptsPanel
                      data={attemptsData}
                      loading={attemptsLoading && attemptsMarketId === m.onChainMarketId}
                    />
                  </div>
                )}

                {/* Inline confirm panel */}
                {isConfirming && (
                  <div className="border-t border-steel px-5 py-4">
                    {confirm.type === "lock" && (
                      <div className="space-y-3">
                        <p className="text-sm text-muted">
                          Lock this market? No new stakes will be accepted after locking.
                          This calls{" "}
                          <code className="font-data text-xs text-frost">lock_market</code>{" "}
                          on-chain and waits for finality.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={handleLock}
                            disabled={submitting}
                            className="rounded-lg border border-market-amber/40 bg-market-amber/20 px-4 py-2 text-sm font-semibold text-amber transition-opacity hover:opacity-90 disabled:opacity-40"
                          >
                            {submitting ? "Locking…" : "Confirm Lock"}
                          </button>
                          <button
                            onClick={() => { setConfirm(null); setActionError(null); }}
                            className="rounded-lg border border-steel bg-graphite px-4 py-2 text-sm text-muted hover:text-frost"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {confirm.type === "resolve" && (
                      <div className="space-y-3">
                        <p className="text-sm text-muted">
                          Trigger GenLayer AI resolution for this market? The contract will fetch
                          evidence and run consensus. The outcome is determined by the contract —
                          not by you. This returns immediately; poll the transaction for finality.
                        </p>
                        <p className="text-xs text-muted/70">
                          A 10-minute cooldown applies if resolution fails. Admin cannot bypass cooldown.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={handleResolve}
                            disabled={submitting}
                            className="rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                          >
                            {submitting ? "Triggering…" : "Confirm Trigger Resolve"}
                          </button>
                          <button
                            onClick={() => { setConfirm(null); setActionError(null); }}
                            className="rounded-lg border border-steel bg-graphite px-4 py-2 text-sm text-muted hover:text-frost"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
