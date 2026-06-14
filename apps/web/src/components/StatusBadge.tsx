import { cn } from "@/lib/utils";
import type { MarketStatus, ConfidenceLevel } from "@/types";

const STATUS_STYLES: Record<string, string> = {
  OPEN: "border-signal-cyan/40 bg-signal-cyan/10 text-cyan",
  LOCKED: "border-market-amber/40 bg-market-amber/10 text-amber",
  RESOLVING: "border-consensus-violet/40 bg-consensus-violet/10 text-violet",
  RESOLVED: "border-verdict-green/40 bg-verdict-green/10 text-green",
  INVALID: "border-liquid-red/40 bg-liquid-red/10 text-red",
  UNRESOLVED: "border-blue-grey/40 bg-blue-grey/10 text-muted",
  CANCELLED: "border-liquid-red/40 bg-liquid-red/10 text-red",
};

export function StatusBadge({ status }: { status: MarketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-data text-xs font-medium tracking-wide",
        STATUS_STYLES[status] ?? "border-steel text-muted",
      )}
    >
      {status}
    </span>
  );
}

const CONFIDENCE_STYLES: Record<string, string> = {
  HIGH: "border-verdict-green/40 bg-verdict-green/10 text-green",
  MEDIUM: "border-market-amber/40 bg-market-amber/10 text-amber",
  LOW: "border-liquid-red/40 bg-liquid-red/10 text-red",
};

export function ConfidenceBadge({ confidence }: { confidence: ConfidenceLevel }) {
  if (!confidence) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-data text-xs font-medium tracking-wide",
        CONFIDENCE_STYLES[confidence] ?? "border-steel text-muted",
      )}
    >
      {confidence} confidence
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  if (!outcome) return null;
  const styles =
    outcome === "YES"
      ? "border-verdict-green/40 bg-verdict-green/10 text-green"
      : "border-liquid-red/40 bg-liquid-red/10 text-red";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 font-display text-sm font-bold tracking-wide",
        styles,
      )}
    >
      {outcome}
    </span>
  );
}

export function TxStatusBadge({ status, executionResult }: { status: string; executionResult: string | null }) {
  if (status === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-market-amber/40 bg-market-amber/10 px-2.5 py-0.5 font-data text-xs text-amber">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-market-amber" />
        PENDING
      </span>
    );
  }
  if (status === "FINALIZED" && executionResult === "SUCCESS") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-verdict-green/40 bg-verdict-green/10 px-2.5 py-0.5 font-data text-xs text-green">
        ✓ CONFIRMED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-liquid-red/40 bg-liquid-red/10 px-2.5 py-0.5 font-data text-xs text-red">
      FAILED
    </span>
  );
}
