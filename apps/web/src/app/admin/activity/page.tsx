"use client";

import { useState, useEffect, useCallback } from "react";
import { admin } from "@/lib/api";
import type { ContractEventRecord } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatGEN } from "@/lib/utils";
import TxLink from "@/components/TxLink";

const EVENT_TYPES = [
  "ALL",
  "MARKET_CREATED",
  "STAKE_YES",
  "STAKE_NO",
  "MARKET_LOCKED",
  "MARKET_RESOLVED",
  "MARKET_INVALID",
  "MARKET_UNRESOLVED",
  "CLAIM_PAYOUT",
  "CLAIM_REFUND",
  "TX_FAILED",
] as const;

const EVENT_LABELS: Record<string, string> = {
  MARKET_CREATED: "Market created",
  STAKE_YES: "Staked YES",
  STAKE_NO: "Staked NO",
  MARKET_LOCKED: "Market locked",
  MARKET_RESOLVED: "Market resolved",
  MARKET_INVALID: "Market invalidated",
  MARKET_UNRESOLVED: "Market unresolved",
  CLAIM_PAYOUT: "Payout claimed",
  CLAIM_REFUND: "Refund claimed",
  TX_FAILED: "Tx failed",
};

const EVENT_COLORS: Record<string, string> = {
  MARKET_CREATED: "text-violet bg-violet/10 border-violet/30",
  STAKE_YES: "text-green bg-verdict-green/10 border-verdict-green/30",
  STAKE_NO: "text-red bg-liquid-red/10 border-liquid-red/30",
  MARKET_LOCKED: "text-amber bg-market-amber/10 border-market-amber/30",
  MARKET_RESOLVED: "text-green bg-verdict-green/10 border-verdict-green/30",
  MARKET_INVALID: "text-red bg-liquid-red/10 border-liquid-red/30",
  MARKET_UNRESOLVED: "text-muted bg-graphite border-steel",
  CLAIM_PAYOUT: "text-green bg-verdict-green/10 border-verdict-green/30",
  CLAIM_REFUND: "text-frost bg-graphite border-steel",
  TX_FAILED: "text-red bg-liquid-red/10 border-liquid-red/30",
};

function EventBadge({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-md border px-2 py-0.5 font-data text-xs",
        EVENT_COLORS[type] ?? "text-muted bg-graphite border-steel",
      )}
    >
      {EVENT_LABELS[type] ?? type}
    </span>
  );
}

export default function AdminActivityPage() {
  const [events, setEvents] = useState<ContractEventRecord[]>([]);
  const [eventTypeFilter, setEventTypeFilter] = useState("ALL");
  const [marketIdFilter, setMarketIdFilter] = useState("");
  const [userAddressFilter, setUserAddressFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await admin.activity.list({
        eventType: eventTypeFilter === "ALL" ? undefined : eventTypeFilter,
        marketId: marketIdFilter.trim() || undefined,
        userAddress: userAddressFilter.trim() || undefined,
      });
      setEvents(res.events);
    } catch {
      setError("Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [eventTypeFilter, marketIdFilter, userAddressFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const failedCount = events.filter((e) => e.eventType === "TX_FAILED").length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-frost">Activity</h1>
          <p className="mt-1 text-xs text-muted">
            Activity history — contract reads remain the source of truth.
          </p>
          {failedCount > 0 && (
            <p className="mt-0.5 text-xs text-red">{failedCount} failed transactions</p>
          )}
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-steel bg-graphite px-3 py-1.5 text-xs text-muted hover:text-frost transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Event type filter pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {EVENT_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setEventTypeFilter(t)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              eventTypeFilter === t
                ? "border-violet bg-violet/10 text-violet"
                : "border-steel bg-graphite text-muted hover:text-frost",
            )}
          >
            {t === "ALL" ? "ALL TYPES" : (EVENT_LABELS[t] ?? t)}
          </button>
        ))}
      </div>

      {/* Text filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter by market ID…"
            value={marketIdFilter}
            onChange={(e) => setMarketIdFilter(e.target.value)}
            className="w-56 rounded-xl border border-steel bg-graphite px-4 py-2 font-data text-xs text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none"
          />
          {marketIdFilter && (
            <button onClick={() => setMarketIdFilter("")} className="text-xs text-muted hover:text-frost">
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter by user address…"
            value={userAddressFilter}
            onChange={(e) => setUserAddressFilter(e.target.value)}
            className="w-56 rounded-xl border border-steel bg-graphite px-4 py-2 font-data text-xs text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none"
          />
          {userAddressFilter && (
            <button onClick={() => setUserAddressFilter("")} className="text-xs text-muted hover:text-frost">
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
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-steel bg-obsidian px-6 py-12 text-center">
          <p className="text-sm text-muted">No events found</p>
          <p className="mt-2 text-xs text-muted/60">
            Events appear here after transactions finalise. The activity feed starts from Stage F onwards.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.map((e) => {
            type Payload = {
              outcome?: string;
              confidence?: string;
              txType?: string;
              errorDescription?: string;
              executionResult?: string;
            };
            const payload = e.payloadJson as Payload | null;
            const isFailed = e.eventType === "TX_FAILED";
            return (
              <div
                key={e.id}
                className={cn(
                  "rounded-xl border bg-obsidian px-5 py-3",
                  isFailed
                    ? "border-liquid-red/40 bg-liquid-red/5"
                    : "border-steel",
                )}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  {/* Event type badge */}
                  <div className="shrink-0">
                    <EventBadge type={e.eventType} />
                  </div>

                  {/* Tx hash + explorer link */}
                  <TxLink hash={e.transactionHash} />

                  {/* Market ID */}
                  {e.marketId && (
                    <span className="font-data text-xs text-muted">
                      mkt:{" "}
                      <span className="text-frost">
                        {e.marketId.slice(0, 12)}…
                      </span>
                    </span>
                  )}

                  {/* User address */}
                  {e.userAddress && (
                    <span className="font-data text-xs text-muted">
                      {e.userAddress.slice(0, 6)}…{e.userAddress.slice(-4)}
                    </span>
                  )}

                  {/* Amount */}
                  {e.valueWei && e.valueWei !== "0" && (
                    <span className="font-data text-xs text-frost">
                      {formatGEN(e.valueWei)} GEN
                    </span>
                  )}

                  {/* Resolution outcome */}
                  {payload?.outcome && (
                    <span className="font-data text-xs text-frost">
                      → {String(payload.outcome)}
                      {payload.confidence ? ` [${String(payload.confidence)}]` : ""}
                    </span>
                  )}

                  {/* Timestamp */}
                  <span className="ml-auto shrink-0 text-xs text-muted">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>

                {/* TX_FAILED details */}
                {isFailed && (
                  <div className="mt-2 rounded-lg border border-liquid-red/20 bg-liquid-red/10 px-3 py-2 font-data text-xs text-red">
                    {payload?.txType && (
                      <span className="mr-3">type: {String(payload.txType)}</span>
                    )}
                    {payload?.errorDescription
                      ? String(payload.errorDescription)
                      : "No error description available"}
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
