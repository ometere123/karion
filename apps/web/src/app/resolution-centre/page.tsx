"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { resolutionCentre } from "@/lib/api";
import type { ResolutionCentreMarket, ResolutionCentreResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatGEN } from "@/lib/utils";
import TxLink from "@/components/TxLink";

// ── Status colours ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  OPEN: "text-green border-verdict-green/30 bg-verdict-green/10",
  LOCKED: "text-amber border-market-amber/30 bg-market-amber/10",
  RESOLVING: "text-violet border-violet/30 bg-violet/10",
  RESOLVED: "text-frost border-steel bg-graphite",
  INVALID: "text-red border-liquid-red/30 bg-liquid-red/10",
  UNRESOLVED: "text-muted border-steel bg-graphite",
  CANCELLED: "text-muted border-steel bg-graphite",
};

const OUTCOME_COLORS: Record<string, string> = {
  YES: "text-green",
  NO: "text-red",
  INVALID: "text-red",
  UNRESOLVED: "text-muted",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-md border px-2 py-0.5 font-data text-xs",
        STATUS_COLORS[status] ?? "text-muted border-steel bg-graphite",
      )}
    >
      {status}
    </span>
  );
}

// ── Market card ───────────────────────────────────────────────────────────────

function MarketCard({ market }: { market: ResolutionCentreMarket }) {
  const lastAttempt = market.resolutionAttempts[0] ?? null;
  const deadline = new Date(market.resolutionDeadline);
  const isPastDeadline = deadline < new Date();
  const total = BigInt(market.yesPoolCached || "0") + BigInt(market.noPoolCached || "0");

  return (
    <div className="rounded-xl border border-steel bg-obsidian px-5 py-4 space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={market.status} />
        {market.finalOutcomeCached && (
          <span
            className={cn(
              "font-data text-xs font-semibold",
              OUTCOME_COLORS[market.finalOutcomeCached] ?? "text-frost",
            )}
          >
            → {market.finalOutcomeCached}
          </span>
        )}
        {market.confidence && (
          <span className="rounded-md border border-steel bg-graphite px-2 py-0.5 font-data text-xs text-muted">
            {market.confidence}
          </span>
        )}
        <span
          className={cn(
            "ml-auto text-xs",
            isPastDeadline ? "text-red" : "text-muted",
          )}
        >
          {isPastDeadline ? "Past deadline · " : "Deadline · "}
          {deadline.toLocaleDateString()}
        </span>
      </div>

      {/* Question */}
      <p className="text-sm font-medium text-frost leading-snug line-clamp-2">
        {market.question}
      </p>

      {/* Pools */}
      {total > 0n && (
        <div className="flex gap-4 font-data text-xs">
          <span className="text-green">YES {formatGEN(market.yesPoolCached)} GEN</span>
          <span className="text-red">NO {formatGEN(market.noPoolCached)} GEN</span>
          <span className="text-muted">Total {formatGEN(total.toString())} GEN</span>
        </div>
      )}

      {/* Resolution note */}
      {market.resolutionNote && (
        <p className="text-xs text-muted italic">{market.resolutionNote}</p>
      )}

      {/* Last resolve attempt */}
      {lastAttempt ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              "rounded-md border px-1.5 py-0.5 font-data",
              lastAttempt.status === "SUCCESS"
                ? "border-verdict-green/30 bg-verdict-green/10 text-green"
                : lastAttempt.status === "FAILED"
                ? "border-liquid-red/30 bg-liquid-red/10 text-red"
                : "border-steel bg-graphite text-muted",
            )}
          >
            {lastAttempt.status === "SUCCESS"
              ? "Resolve succeeded"
              : lastAttempt.status === "FAILED"
              ? "Last resolve failed"
              : "Resolving…"}
          </span>
          {lastAttempt.transactionHash && (
            <TxLink hash={lastAttempt.transactionHash} />
          )}
          {lastAttempt.errorMessage && (
            <span className="text-red truncate max-w-xs">
              {lastAttempt.errorMessage}
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">No resolve attempts recorded</p>
      )}

      {/* Footer links */}
      <div className="flex items-center gap-4 pt-1">
        <Link
          href={`/markets/${market.onChainMarketId}`}
          className="text-xs text-violet hover:underline"
        >
          View market →
        </Link>
        <Link
          href={`/markets/${market.onChainMarketId}`}
          className="text-xs text-muted hover:text-frost"
        >
          Activity timeline
        </Link>
        <span className="ml-auto font-data text-xs text-muted/60">
          {market.onChainMarketId}
        </span>
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  title,
  markets,
  emptyLabel,
}: {
  title: string;
  markets: ResolutionCentreMarket[];
  emptyLabel?: string;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-display text-base font-semibold text-frost">{title}</h2>
        <span className="rounded-full border border-steel bg-graphite px-2 py-0.5 font-data text-xs text-muted">
          {markets.length}
        </span>
      </div>
      {markets.length === 0 ? (
        <div className="rounded-xl border border-steel bg-obsidian px-5 py-6 text-center">
          <p className="text-sm text-muted">{emptyLabel ?? "None"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {markets.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ResolutionCentrePage() {
  const [data, setData] = useState<ResolutionCentreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    resolutionCentre
      .list()
      .then(setData)
      .catch(() => setError("Failed to load resolution centre data"))
      .finally(() => setLoading(false));
  }, []);

  const total = data
    ? data.pastDeadline.length +
      data.awaitingResolution.length +
      data.recentlyResolved.length +
      data.invalid.length +
      data.unresolved.length
    : 0;

  return (
    <main className="min-h-screen bg-deep-ink">
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-frost">
            Resolution Centre
          </h1>
          <div className="mt-3 space-y-1">
            <p className="text-sm text-muted">
              GenLayer resolves outcomes.{" "}
              <span className="text-muted/70">Backend only triggers resolution.</span>
            </p>
            <p className="text-xs text-muted/60">
              Contract state is authoritative.
              Activity history — contract reads remain the source of truth.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-5 w-40 animate-pulse rounded-lg bg-graphite" />
                <div className="h-28 animate-pulse rounded-xl bg-graphite" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-liquid-red/30 bg-liquid-red/5 px-6 py-8 text-center">
            <p className="text-sm text-red">{error}</p>
            <p className="mt-2 text-xs text-muted">
              Make sure you are logged in and the API is reachable.
            </p>
          </div>
        ) : total === 0 ? (
          <div className="rounded-xl border border-steel bg-obsidian px-6 py-12 text-center">
            <p className="text-sm text-muted">No markets in resolution state</p>
            <p className="mt-2 text-xs text-muted/60">
              Markets appear here once their deadline has passed or they are
              locked for resolution.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {data!.pastDeadline.length > 0 && (
              <Section
                title="Past Deadline — Pending Resolve"
                markets={data!.pastDeadline}
                emptyLabel="No markets past deadline"
              />
            )}

            {data!.awaitingResolution.length > 0 && (
              <Section
                title="Awaiting Resolution"
                markets={data!.awaitingResolution}
                emptyLabel="No markets awaiting resolution"
              />
            )}

            <Section
              title="Recently Resolved"
              markets={data!.recentlyResolved}
              emptyLabel="No markets resolved in the last 30 days"
            />

            <Section
              title="Invalid"
              markets={data!.invalid}
              emptyLabel="No invalid markets"
            />

            <Section
              title="Unresolved"
              markets={data!.unresolved}
              emptyLabel="No unresolved markets"
            />
          </div>
        )}
      </div>
    </main>
  );
}
