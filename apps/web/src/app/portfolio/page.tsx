"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { portfolio } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { StatusBadge, OutcomeBadge } from "@/components/StatusBadge";
import { formatGEN, shortenAddress } from "@/lib/utils";
import type { PortfolioResponse, MarketPosition } from "@/types";

function PositionCard({ pos }: { pos: MarketPosition }) {
  const m = pos.market;
  const stakeWei = pos.amountGen;
  const deadline = new Date(m.resolutionDeadline);
  const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);

  const sideColor = pos.side === "YES" ? "text-green" : "text-red";
  const sideBorder =
    pos.side === "YES"
      ? "border-verdict-green/30 bg-verdict-green/5"
      : "border-liquid-red/30 bg-liquid-red/5";

  return (
    <Link
      href={`/markets/${pos.onChainMarketId}`}
      className="block group"
    >
      <div
        className={`rounded-xl border ${sideBorder} p-5 transition-all hover:border-opacity-60`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <StatusBadge status={m.status} />
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`font-data text-sm font-bold ${sideColor}`}>
              {pos.side}
            </span>
            {m.finalOutcomeCached && (
              <OutcomeBadge outcome={m.finalOutcomeCached} />
            )}
          </div>
        </div>

        <h3 className="font-display text-base font-semibold leading-snug text-frost line-clamp-2 group-hover:text-white transition-colors">
          {m.question}
        </h3>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="font-data text-xs text-muted">Staked</p>
            <p className="font-data text-sm text-frost">
              {formatGEN(stakeWei)} GEN
            </p>
          </div>
          <div>
            <p className="font-data text-xs text-muted">
              {daysLeft > 0 ? "Expires" : "Expired"}
            </p>
            <p className="font-data text-sm text-frost">
              {daysLeft > 0 ? `${daysLeft}d` : deadline.toLocaleDateString()}
            </p>
          </div>
        </div>

        {(m.status === "RESOLVED" || m.status === "INVALID") && (
          <div className="mt-3 pt-3 border-t border-steel flex items-center justify-between">
            <span className="font-data text-xs text-muted">
              {pos.claimed ? "Claimed" : "Unclaimed"}
            </span>
            {!pos.claimed && (
              <span className="font-data text-xs text-green">
                → Claim available
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

export default function PortfolioPage() {
  const { user, hydrated } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.push("/login");
      return;
    }
    portfolio
      .get()
      .then(setData)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load portfolio"),
      )
      .finally(() => setLoading(false));
  }, [hydrated, user, router]);

  if (!hydrated || loading) {
    return (
      <main className="min-h-screen bg-deep-ink">
        <div className="mx-auto max-w-3xl px-6 py-12 space-y-4">
          <div className="h-8 w-40 animate-pulse rounded-lg bg-graphite" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-graphite" />
          ))}
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-deep-ink flex items-center justify-center">
        <p className="text-red">{error}</p>
      </main>
    );
  }

  const positions = data?.positions ?? [];
  const active = positions.filter(
    (p) => p.market.status === "OPEN" || p.market.status === "LOCKED" || p.market.status === "RESOLVING",
  );
  const resolved = positions.filter(
    (p) => p.market.status === "RESOLVED" || p.market.status === "INVALID",
  );
  const claimable = resolved.filter((p) => !p.claimed);

  return (
    <main className="min-h-screen bg-deep-ink">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-frost">Portfolio</h1>
            <p className="mt-1 font-data text-xs text-muted">
              {data?.walletAddress
                ? shortenAddress(data.walletAddress, 6)
                : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="font-data text-2xl font-bold text-frost">
              {positions.length}
            </p>
            <p className="font-data text-xs text-muted">position{positions.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {data?.note && (
          <div className="mb-6 rounded-xl border border-steel bg-graphite px-4 py-3 font-data text-xs text-muted">
            {data.note}
          </div>
        )}

        {positions.length === 0 && (
          <div className="rounded-xl border border-steel bg-graphite p-12 text-center">
            <p className="text-muted mb-4">No positions yet.</p>
            <Link
              href="/markets"
              className="rounded-xl bg-violet px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            >
              Browse Markets
            </Link>
          </div>
        )}

        {claimable.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-sm font-semibold text-frost mb-4 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-verdict-green" />
              Ready to claim ({claimable.length})
            </h2>
            <div className="space-y-3">
              {claimable.map((p) => (
                <PositionCard key={p.id} pos={p} />
              ))}
            </div>
          </section>
        )}

        {active.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-sm font-semibold text-frost mb-4">
              Active ({active.length})
            </h2>
            <div className="space-y-3">
              {active.map((p) => (
                <PositionCard key={p.id} pos={p} />
              ))}
            </div>
          </section>
        )}

        {resolved.filter((p) => p.claimed).length > 0 && (
          <section>
            <h2 className="font-display text-sm font-semibold text-muted mb-4">
              Settled
            </h2>
            <div className="space-y-3">
              {resolved
                .filter((p) => p.claimed)
                .map((p) => (
                  <PositionCard key={p.id} pos={p} />
                ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
