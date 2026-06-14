"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { admin } from "@/lib/api";
import type { AdminTransaction } from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortenAddress, formatGEN } from "@/lib/utils";
import TxLink from "@/components/TxLink";
import CopyButton from "@/components/CopyButton";

const TX_TYPES = [
  "ALL",
  "CREATE_MARKET",
  "STAKE_YES",
  "STAKE_NO",
  "LOCK_MARKET",
  "RESOLVE_MARKET",
  "CLAIM_PAYOUT",
  "CLAIM_REFUND",
];

const STATUS_COLORS: Record<string, string> = {
  PENDING: "text-amber bg-market-amber/10 border-market-amber/30",
  FINALIZED: "text-green bg-verdict-green/10 border-verdict-green/30",
  ERROR: "text-red bg-liquid-red/10 border-liquid-red/30",
};

const RESULT_COLORS: Record<string, string> = {
  SUCCESS: "text-green",
  ERROR: "text-red",
};


export default function AdminTransactionsPage() {
  const [txs, setTxs] = useState<AdminTransaction[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [userAddress, setUserAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await admin.transactions.list({
        status: statusFilter === "ALL" ? undefined : statusFilter,
        type: typeFilter === "ALL" ? undefined : typeFilter,
        userAddress: userAddress.trim() || undefined,
      });
      setTxs(res.transactions);
    } catch {
      setError("Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, userAddress]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Auto-poll every 5s when any PENDING row is visible
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const hasPending = txs.some((t) => t.status === "PENDING");
    if (hasPending) {
      pollRef.current = setInterval(load, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [txs, load]);

  const pendingCount = txs.filter((t) => t.status === "PENDING").length;
  const errorCount = txs.filter(
    (t) => t.status === "ERROR" || t.executionResult === "ERROR",
  ).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-frost">
            Transactions
          </h1>
          <div className="mt-1 flex gap-4 text-xs">
            {pendingCount > 0 && (
              <span className="text-amber">
                {pendingCount} pending (polling every 5s)
              </span>
            )}
            {errorCount > 0 && (
              <span className="text-red">{errorCount} failed</span>
            )}
          </div>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-steel bg-graphite px-3 py-1.5 text-xs text-muted hover:text-frost transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {["ALL", "PENDING", "FINALIZED", "ERROR"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                statusFilter === s
                  ? "border-violet bg-violet/10 text-violet"
                  : "border-steel bg-graphite text-muted hover:text-frost",
              )}
            >
              {s}
            </button>
          ))}
          <div className="mx-1 w-px bg-steel" />
          {TX_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                typeFilter === t
                  ? "border-violet bg-violet/10 text-violet"
                  : "border-steel bg-graphite text-muted hover:text-frost",
              )}
            >
              {t === "ALL" ? "ALL TYPES" : t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter by user address…"
            value={userAddress}
            onChange={(e) => setUserAddress(e.target.value)}
            className="w-72 rounded-xl border border-steel bg-graphite px-4 py-2 font-data text-xs text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none"
          />
          {userAddress && (
            <button
              onClick={() => setUserAddress("")}
              className="text-xs text-muted hover:text-frost"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-graphite" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-liquid-red/30 bg-liquid-red/5 px-6 py-8 text-center">
          <p className="text-sm text-red">{error}</p>
          <button
            onClick={load}
            className="mt-4 rounded-lg border border-steel bg-graphite px-4 py-2 text-xs text-muted hover:text-frost transition-colors"
          >
            ↻ Retry
          </button>
        </div>
      ) : txs.length === 0 ? (
        <div className="rounded-xl border border-steel bg-obsidian px-6 py-12 text-center">
          <p className="text-sm text-muted">No transactions found</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {txs.map((tx) => {
            const isFailed =
              tx.status === "ERROR" || tx.executionResult === "ERROR";
            const isPending = tx.status === "PENDING";

            return (
              <div
                key={tx.id}
                className={cn(
                  "rounded-xl border bg-obsidian px-5 py-3",
                  isFailed
                    ? "border-liquid-red/40 bg-liquid-red/5"
                    : isPending
                      ? "border-market-amber/30"
                      : "border-steel",
                )}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  {/* Status + type */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        "inline-block rounded-md border px-2 py-0.5 font-data text-xs",
                        STATUS_COLORS[tx.status] ??
                          "text-muted bg-graphite border-steel",
                      )}
                    >
                      {tx.status}
                    </span>
                    <span className="font-data text-xs text-muted">
                      {tx.txType}
                    </span>
                  </div>

                  {/* Tx hash — explorer link + copy */}
                  <div className="flex items-center">
                    <TxLink hash={tx.txHash} />
                  </div>

                  {/* Market + user */}
                  <div className="flex flex-wrap gap-3 text-xs text-muted">
                    {tx.onChainMarketId && (
                      <span>
                        Market:{" "}
                        <span className="font-data text-frost">
                          {tx.onChainMarketId.slice(0, 20)}
                          {tx.onChainMarketId.length > 20 ? "…" : ""}
                        </span>
                      </span>
                    )}
                    {tx.userAddress && (
                      <span className="flex items-center gap-1">
                        User:{" "}
                        <span className="font-data text-frost">
                          {shortenAddress(tx.userAddress, 4)}
                        </span>
                        <CopyButton text={tx.userAddress} label="user address" />
                      </span>
                    )}
                    {tx.valueWei && tx.valueWei !== "0" && (
                      <span>
                        Value:{" "}
                        <span className="font-data text-frost">
                          {formatGEN(tx.valueWei)} GEN
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Result + time */}
                  <div className="ml-auto flex items-center gap-3 shrink-0 text-xs">
                    {tx.executionResult && (
                      <span
                        className={
                          RESULT_COLORS[tx.executionResult] ?? "text-muted"
                        }
                      >
                        {tx.executionResult}
                      </span>
                    )}
                    <span className="text-muted">
                      {new Date(tx.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Error description — shown prominently for failed txs */}
                {isFailed && tx.errorDescription && (
                  <div className="mt-2 rounded-lg border border-liquid-red/20 bg-liquid-red/10 px-3 py-2 font-data text-xs text-red">
                    {tx.errorDescription}
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
