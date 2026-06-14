import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { formatGEN } from "@/lib/utils";
import type { Market } from "@/types";

function PoolBar({ yes, no }: { yes: string; no: string }) {
  const y = BigInt(yes || "0");
  const n = BigInt(no || "0");
  const total = y + n;
  if (total === 0n) return null;
  const yesPct = Number((y * 100n) / total);
  return (
    <div className="mt-3">
      <div className="flex justify-between font-data text-xs text-muted mb-1">
        <span className="text-green">YES {yesPct}%</span>
        <span className="text-red">NO {100 - yesPct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-panel">
        <div
          className="h-full rounded-full bg-verdict-green transition-all"
          style={{ width: `${yesPct}%` }}
        />
      </div>
    </div>
  );
}

export default function MarketCard({ market }: { market: Market }) {
  const total = BigInt(market.totalPoolCached || "0");
  const deadline = new Date(market.resolutionDeadline);
  const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);

  return (
    <Link href={`/markets/${market.onChainMarketId}`} className="block group">
      <div className="rounded-xl border border-steel bg-graphite p-5 transition-all duration-150 hover:border-blue-grey group-hover:bg-slate-panel">
        <div className="flex items-start justify-between gap-3">
          <StatusBadge status={market.status} />
          <span className="font-data text-xs text-muted whitespace-nowrap">
            {daysLeft > 0 ? `${daysLeft}d left` : "Expired"}
          </span>
        </div>

        <h3 className="mt-3 font-display text-base font-semibold leading-snug text-frost line-clamp-2 group-hover:text-white transition-colors">
          {market.question}
        </h3>

        <div className="mt-3 flex items-center justify-between">
          <span className="rounded-md bg-slate-panel px-2 py-0.5 font-data text-xs text-muted">
            {market.category}
          </span>
          <span className="font-data text-xs text-muted">
            {total > 0n ? `${formatGEN(total.toString())} GEN staked` : "No stakes yet"}
          </span>
        </div>

        {total > 0n && (
          <PoolBar yes={market.yesPoolCached} no={market.noPoolCached} />
        )}

        {market.finalOutcomeCached && (
          <div className="mt-3 flex items-center gap-2">
            <span className="font-data text-xs text-muted">Outcome:</span>
            <span
              className={`font-display text-sm font-bold ${market.finalOutcomeCached === "YES" ? "text-green" : "text-red"}`}
            >
              {market.finalOutcomeCached}
            </span>
            {market.confidence && (
              <span className="font-data text-xs text-muted">· {market.confidence}</span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
