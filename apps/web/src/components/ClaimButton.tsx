"use client";

// ClaimButton — reads contract-backed status from the market detail API.
// Decides claim vs refund is handled by the backend (contract routes to claimPayout
// or claimRefund based on contract status). Frontend just calls POST /claim.
// Does NOT determine eligibility from its own logic.

import { useState } from "react";
import { markets } from "@/lib/api";
import TxPoller from "@/components/TxPoller";
import type { Transaction } from "@/types";

interface Props {
  marketId: string;
  onSuccess?: () => void;
}

export default function ClaimButton({ marketId, onSuccess }: Props) {
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClaim() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await markets.claim(marketId);
      setTxHash(res.txHash);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleFinalized(tx: Transaction) {
    if (tx.executionResult === "SUCCESS" && onSuccess) {
      setTimeout(onSuccess, 1200);
    }
  }

  if (txHash) {
    return (
      <div className="space-y-3">
        <TxPoller txHash={txHash} onFinalized={handleFinalized} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClaim}
        disabled={submitting}
        className="w-full rounded-xl bg-verdict-green py-3 text-sm font-semibold text-white transition-all hover:bg-verdict-green/90 disabled:opacity-40"
      >
        {submitting ? "Submitting…" : "Claim"}
      </button>
      {error && <p className="text-xs text-red">{error}</p>}
    </div>
  );
}
