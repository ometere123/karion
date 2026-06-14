"use client";

import { useEffect, useState } from "react";
import { markets } from "@/lib/api";
import MarketCard from "@/components/MarketCard";
import type { Market, MarketStatus } from "@/types";

const STATUS_FILTERS: Array<MarketStatus | "ALL"> = [
  "ALL",
  "OPEN",
  "LOCKED",
  "RESOLVING",
  "RESOLVED",
  "INVALID",
];

export default function MarketsPage() {
  const [marketList, setMarketList] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MarketStatus | "ALL">("ALL");

  useEffect(() => {
    markets
      .list()
      .then((r) => setMarketList(r.markets))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load markets"))
      .finally(() => setLoading(false));
  }, []);

  const filtered =
    filter === "ALL"
      ? marketList
      : marketList.filter((m) => m.status === filter);

  return (
    <main className="min-h-screen bg-deep-ink">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-8">
          <h1 className="font-display text-4xl font-bold text-frost">Markets</h1>
          <p className="mt-2 text-sm text-muted">
            {marketList.length} market{marketList.length !== 1 ? "s" : ""} · resolved by GenLayer consensus
          </p>
        </div>

        {/* Status filter */}
        <div className="mb-8 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 font-data text-xs transition-colors ${
                filter === s
                  ? "border-violet bg-violet/20 text-violet"
                  : "border-steel bg-graphite text-muted hover:border-blue-grey hover:text-frost"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="h-48 animate-pulse rounded-xl border border-steel bg-graphite"
              />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-liquid-red/30 bg-liquid-red/10 p-6 text-center text-sm text-red">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-xl border border-steel bg-graphite p-12 text-center">
            <p className="text-muted">No markets found for the selected filter.</p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
