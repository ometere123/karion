"use client";

// Polls GET /api/transactions/:txHash every 3 s until FINALIZED or ERROR.
// Shows a spinner while pending, a success or error state on completion.
// Does NOT show success until executionResult === "SUCCESS" from the backend.

import { useEffect, useState, useCallback } from "react";
import { transactions } from "@/lib/api";
import { TxStatusBadge } from "@/components/StatusBadge";
import type { Transaction } from "@/types";

interface Props {
  txHash: string;
  onFinalized?: (tx: Transaction) => void;
  compact?: boolean;
}

export default function TxPoller({ txHash, onFinalized, compact = false }: Props) {
  const [tx, setTx] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await transactions.get(txHash);
      setTx(res.transaction);
      if (res.transaction.status === "FINALIZED" || res.transaction.status === "ERROR") {
        if (onFinalized) onFinalized(res.transaction);
        return true; // stop polling
      }
    } catch {
      setError("Failed to fetch transaction status");
      return true; // stop on error
    }
    return false;
  }, [txHash, onFinalized]);

  useEffect(() => {
    let stopped = false;

    const run = async () => {
      const done = await poll();
      if (done || stopped) return;
      const id = setInterval(async () => {
        const done = await poll();
        if (done || stopped) clearInterval(id);
      }, 3000);
      return () => clearInterval(id);
    };

    run();
    return () => { stopped = true; };
  }, [poll]);

  const short = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`;
  const explorerUrl = `${process.env.NEXT_PUBLIC_GENLAYER_EXPLORER_URL}/tx/${txHash}`;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {tx ? (
          <TxStatusBadge status={tx.status} executionResult={tx.executionResult} />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-market-amber/40 bg-market-amber/10 px-2.5 py-0.5 font-data text-xs text-amber">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-market-amber" />
            CONFIRMING
          </span>
        )}
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-data text-xs text-muted hover:text-frost transition-colors"
        >
          {short}
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-steel bg-graphite p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted mb-1">Transaction</p>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-data text-xs text-frost hover:text-violet transition-colors break-all"
          >
            {txHash}
          </a>
        </div>
        <div className="flex-shrink-0">
          {tx ? (
            <TxStatusBadge status={tx.status} executionResult={tx.executionResult} />
          ) : error ? (
            <span className="font-data text-xs text-red">{error}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-market-amber/40 bg-market-amber/10 px-2.5 py-0.5 font-data text-xs text-amber">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-market-amber" />
              CONFIRMING
            </span>
          )}
        </div>
      </div>

      {tx?.status === "FINALIZED" && tx.executionResult === "SUCCESS" && (
        <p className="mt-3 text-sm text-green">
          Transaction confirmed on GenLayer.
        </p>
      )}

      {tx?.status === "FINALIZED" && tx.executionResult === "ERROR" && (
        <p className="mt-3 text-sm text-red">
          Contract execution failed.{tx.errorDescription ? ` ${tx.errorDescription}` : ""}
        </p>
      )}

      {tx?.status === "ERROR" && (
        <p className="mt-3 text-sm text-red">Transaction failed to finalize.</p>
      )}
    </div>
  );
}
