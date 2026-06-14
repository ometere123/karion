"use client";

// Market detail page — prioritises live contract reads (onChain) for all
// financial state: pools, status, outcome, confidence.
// Falls back to cached DB values only for fields not in the contract.
// User position comes from GET /api/markets/:id/position (contract read).

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { markets } from "@/lib/api";
import type { ContractEventRecord } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import {
  StatusBadge,
  ConfidenceBadge,
  OutcomeBadge,
} from "@/components/StatusBadge";
import StakeModal from "@/components/StakeModal";
import ClaimButton from "@/components/ClaimButton";
import { formatGEN, formatDeadline } from "@/lib/utils";
import type {
  MarketDetailResponse,
  ContractPosition,
  MarketStatus,
} from "@/types";

import TxLink from "@/components/TxLink";

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
  TX_FAILED: "Transaction failed",
};

const EVENT_COLORS: Record<string, string> = {
  MARKET_CREATED: "text-violet",
  STAKE_YES: "text-green",
  STAKE_NO: "text-red",
  MARKET_LOCKED: "text-amber",
  MARKET_RESOLVED: "text-green",
  MARKET_INVALID: "text-red",
  MARKET_UNRESOLVED: "text-muted",
  CLAIM_PAYOUT: "text-green",
  CLAIM_REFUND: "text-frost",
  TX_FAILED: "text-red",
};

function ActivityTimeline({ marketId }: { marketId: string }) {
  const [events, setEvents] = useState<ContractEventRecord[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    markets
      .activity(marketId)
      .then((res) => setEvents(res.events))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [marketId]);

  return (
    <div className="mt-6 rounded-xl border border-steel bg-graphite p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold text-frost">
          Activity
        </h2>
        <span className="text-xs text-muted">
          Activity history — contract reads remain the source of truth.
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-7 animate-pulse rounded-lg bg-graphite/60" />
          ))}
        </div>
      ) : !events?.length ? (
        <p className="text-xs text-muted">
          No activity recorded yet. Events appear here after transactions finalise on-chain.
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            type Payload = { outcome?: string; confidence?: string; errorDescription?: string };
            const payload = e.payloadJson as Payload | null;
            return (
              <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 border-b border-steel/50 last:border-0">
                <span
                  className={`text-xs font-medium ${EVENT_COLORS[e.eventType] ?? "text-muted"}`}
                >
                  {EVENT_LABELS[e.eventType] ?? e.eventType}
                </span>

                {e.valueWei && e.valueWei !== "0" && (
                  <span className="font-data text-xs text-frost">
                    +{formatGEN(e.valueWei)} GEN
                  </span>
                )}

                {e.userAddress && (
                  <span className="font-data text-xs text-muted">
                    {e.userAddress.slice(0, 6)}…{e.userAddress.slice(-4)}
                  </span>
                )}

                {payload?.outcome && (
                  <span className="font-data text-xs text-frost">
                    → {String(payload.outcome)}
                    {payload.confidence ? ` [${String(payload.confidence)}]` : ""}
                  </span>
                )}

                {e.eventType === "TX_FAILED" && payload?.errorDescription && (
                  <span className="text-xs text-red truncate max-w-xs">
                    {String(payload.errorDescription)}
                  </span>
                )}

                <span className="ml-auto text-xs text-muted">
                  {new Date(e.createdAt).toLocaleString()}
                </span>

                <TxLink hash={e.transactionHash} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pool percentage bar using BigInt arithmetic
function PoolBar({ yes, no }: { yes: string; no: string }) {
  const y = BigInt(yes || "0");
  const n = BigInt(no || "0");
  const total = y + n;
  if (total === 0n) return null;
  const yesPct = Number((y * 100n) / total);
  return (
    <div>
      <div className="flex justify-between font-data text-xs text-muted mb-1.5">
        <span className="text-green">YES {yesPct}%</span>
        <span className="text-red">NO {100 - yesPct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-panel">
        <div
          className="h-full rounded-full bg-verdict-green transition-all duration-500"
          style={{ width: `${yesPct}%` }}
        />
      </div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-steel last:border-0">
      <span className="text-sm text-muted flex-shrink-0">{label}</span>
      <span className="font-data text-sm text-frost text-right">{value}</span>
    </div>
  );
}

export default function MarketDetailPage() {
  const params = useParams();
  const marketId = String(params.id);
  const { user, hydrated } = useAuthStore();

  const [detail, setDetail] = useState<MarketDetailResponse | null>(null);
  const [position, setPosition] = useState<ContractPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stakeModal, setStakeModal] = useState<"YES" | "NO" | null>(null);

  const loadDetail = useCallback(async () => {
    try {
      const [det, pos] = await Promise.all([
        markets.detail(marketId),
        user ? markets.position(marketId).catch(() => null) : Promise.resolve(null),
      ]);
      setDetail(det);
      if (pos) setPosition(pos.position);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load market");
    } finally {
      setLoading(false);
    }
  }, [marketId, user]);

  useEffect(() => {
    if (!hydrated) return;
    loadDetail();
  }, [hydrated, loadDetail]);

  if (loading) {
    return (
      <main className="min-h-screen bg-deep-ink">
        <div className="mx-auto max-w-3xl px-6 py-12 space-y-4">
          <div className="h-8 w-24 animate-pulse rounded-lg bg-graphite" />
          <div className="h-56 animate-pulse rounded-xl bg-graphite" />
          <div className="h-40 animate-pulse rounded-xl bg-graphite" />
        </div>
      </main>
    );
  }

  if (error || !detail) {
    const isNotFound = !detail && !error;
    return (
      <main className="min-h-screen bg-deep-ink flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-xl border border-steel bg-obsidian px-8 py-10 text-center">
          <p className="font-data text-xs text-muted mb-2">
            {isNotFound ? "404" : "Error"}
          </p>
          <h1 className="font-display text-xl font-bold text-frost mb-2">
            {isNotFound ? "Market not found" : "Failed to load market"}
          </h1>
          <p className="text-sm text-muted mb-6">
            {error ?? "This market does not exist or the ID is incorrect."}
          </p>
          <a
            href="/markets"
            className="inline-block rounded-xl bg-violet px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            ← Browse Markets
          </a>
        </div>
      </main>
    );
  }

  const { market, onChain } = detail;

  // Live contract values take priority; fall back to DB cache
  const liveStatus: MarketStatus = (onChain?.status ?? market.status) as MarketStatus;
  const liveYesPool = onChain?.yes_pool ?? market.yesPoolCached;
  const liveNoPool = onChain?.no_pool ?? market.noPoolCached;
  const liveTotal = (BigInt(liveYesPool || "0") + BigInt(liveNoPool || "0")).toString();
  const liveOutcome = onChain?.outcome ?? market.finalOutcomeCached;
  const liveConfidence = onChain?.confidence
    ? (onChain.confidence as "HIGH" | "MEDIUM" | "LOW" | "")
    : market.confidence;

  // Deadline: prefer onChain (unix timestamp string) else ISO string from DB
  const deadlineDisplay = onChain?.deadline
    ? formatDeadline(Number(onChain.deadline))
    : new Date(market.resolutionDeadline).toLocaleString();

  // User position
  const hasYesStake =
    position && BigInt(position.yes_stake || "0") > 0n;
  const hasNoStake =
    position && BigInt(position.no_stake || "0") > 0n;
  const hasPosition = hasYesStake || hasNoStake;
  const alreadyClaimed = position?.claimed ?? false;

  // Can claim: market is RESOLVED or INVALID, user has position, not yet claimed
  const canClaim =
    user &&
    hasPosition &&
    !alreadyClaimed &&
    (liveStatus === "RESOLVED" || liveStatus === "INVALID");

  const canStake = user && liveStatus === "OPEN";

  return (
    <main className="min-h-screen bg-deep-ink">
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <StatusBadge status={liveStatus} />
          {liveOutcome && <OutcomeBadge outcome={liveOutcome} />}
          {liveConfidence && <ConfidenceBadge confidence={liveConfidence} />}
          {!onChain && (
            <span className="font-data text-xs text-muted">(cached)</span>
          )}
        </div>

        <h1 className="font-display text-3xl font-bold leading-snug text-frost">
          {market.question}
        </h1>

        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-md bg-slate-panel px-2 py-0.5 font-data text-xs text-muted">
            {market.category}
          </span>
          <span className="rounded-md bg-slate-panel px-2 py-0.5 font-data text-xs text-muted">
            ID: {market.onChainMarketId}
          </span>
        </div>

        {/* Pool */}
        <div className="mt-8 rounded-xl border border-steel bg-graphite p-5">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="rounded-lg bg-verdict-green/10 border border-verdict-green/20 p-3">
              <p className="font-data text-xs text-muted mb-1">YES Pool</p>
              <p className="font-data text-lg font-semibold text-green">
                {formatGEN(liveYesPool)} GEN
              </p>
            </div>
            <div className="rounded-lg bg-liquid-red/10 border border-liquid-red/20 p-3">
              <p className="font-data text-xs text-muted mb-1">NO Pool</p>
              <p className="font-data text-lg font-semibold text-red">
                {formatGEN(liveNoPool)} GEN
              </p>
            </div>
          </div>
          {liveTotal !== "0" && (
            <PoolBar yes={liveYesPool} no={liveNoPool} />
          )}
          <p className="mt-3 font-data text-xs text-muted">
            Total: {formatGEN(liveTotal)} GEN staked
          </p>
        </div>

        {/* Details */}
        <div className="mt-6 rounded-xl border border-steel bg-graphite p-5">
          <h2 className="font-display text-sm font-semibold text-frost mb-3">
            Resolution Details
          </h2>
          <div>
            <DataRow label="Deadline" value={deadlineDisplay} />
            {onChain?.yes_condition && (
              <DataRow label="YES condition" value={onChain.yes_condition} />
            )}
            {onChain?.no_condition && (
              <DataRow label="NO condition" value={onChain.no_condition} />
            )}
            {onChain?.invalid_condition && (
              <DataRow label="Invalid condition" value={onChain.invalid_condition} />
            )}
            {onChain?.resolution_url && (
              <DataRow
                label="Resolution source"
                value={
                  <a
                    href={onChain.resolution_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet hover:underline break-all"
                  >
                    {onChain.resolution_url}
                  </a>
                }
              />
            )}
            {market.resolutionNote && (
              <DataRow label="Resolution note" value={market.resolutionNote} />
            )}
          </div>
        </div>

        {/* User position */}
        {user && (hasPosition || alreadyClaimed) && (
          <div className="mt-6 rounded-xl border border-steel bg-graphite p-5">
            <h2 className="font-display text-sm font-semibold text-frost mb-3">
              Your Position
            </h2>
            <div>
              {hasYesStake && (
                <DataRow
                  label="YES stake"
                  value={`${formatGEN(position!.yes_stake)} GEN`}
                />
              )}
              {hasNoStake && (
                <DataRow
                  label="NO stake"
                  value={`${formatGEN(position!.no_stake)} GEN`}
                />
              )}
              <DataRow
                label="Status"
                value={
                  alreadyClaimed ? (
                    <span className="text-green">Claimed</span>
                  ) : (
                    <span className="text-muted">Unclaimed</span>
                  )
                }
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 space-y-3">
          {canStake && (
            <div className="flex gap-3">
              <button
                onClick={() => setStakeModal("YES")}
                className="flex-1 rounded-xl bg-verdict-green py-3 text-sm font-semibold text-white transition-all hover:bg-verdict-green/90"
              >
                Stake YES
              </button>
              <button
                onClick={() => setStakeModal("NO")}
                className="flex-1 rounded-xl bg-liquid-red py-3 text-sm font-semibold text-white transition-all hover:bg-liquid-red/90"
              >
                Stake NO
              </button>
            </div>
          )}

          {canClaim && (
            <ClaimButton
              marketId={market.onChainMarketId}
              onSuccess={loadDetail}
            />
          )}

          {!user && (
            <p className="text-center text-sm text-muted">
              <a href="/login" className="text-frost hover:text-white transition-colors">
                Log in
              </a>{" "}
              to stake or claim
            </p>
          )}

          {user && !canStake && !canClaim && !hasPosition && (
            <p className="text-center text-sm text-muted">
              {liveStatus === "OPEN"
                ? "Market is open — stake above."
                : `Market is ${liveStatus.toLowerCase()} and you have no position.`}
            </p>
          )}
        </div>

        {/* Activity timeline */}
        <ActivityTimeline marketId={market.onChainMarketId} />
      </div>

      {/* Stake modal */}
      {stakeModal && (
        <StakeModal
          marketId={market.onChainMarketId}
          side={stakeModal}
          onClose={() => setStakeModal(null)}
          onSuccess={() => {
            setStakeModal(null);
            loadDetail();
          }}
        />
      )}
    </main>
  );
}
