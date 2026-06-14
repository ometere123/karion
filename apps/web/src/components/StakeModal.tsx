"use client";

// Stake modal — converts GEN input to wei via genToWei (BigInt-safe, no Number()).
// Only sends amountWei as a string with confirm:true.
// Shows TxPoller after submit; does NOT show success until FINALIZED+SUCCESS.
// Shows live wallet balance on open; warns (but does not block) if amount > balance.

import { useState, useRef, useEffect } from "react";
import { markets, wallet, genToWei } from "@/lib/api";
import type { WalletBalance } from "@/lib/api";
import TxPoller from "@/components/TxPoller";
import type { Transaction } from "@/types";

interface Props {
  marketId: string;
  side: "YES" | "NO";
  onClose: () => void;
  onSuccess?: () => void;
}

export default function StakeModal({ marketId, side, onClose, onSuccess }: Props) {
  const [genInput, setGenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [walletBalance, setWalletBalance] = useState<WalletBalance | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Fetch balance on open — non-blocking, best-effort
    wallet.balance().then(setWalletBalance).catch(() => {});
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // BigInt comparison — returns true if entered amount exceeds balance.
  // Only evaluated when we have both a valid input and a known balance.
  function exceedsBalance(): boolean {
    if (!walletBalance || !genInput) return false;
    const amountWei = genToWei(genInput);
    if (!amountWei) return false;
    try {
      return BigInt(amountWei) > BigInt(walletBalance.balanceWei);
    } catch {
      return false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amountWei = genToWei(genInput);
    if (!amountWei) {
      setError(
        "Enter a valid positive GEN amount (e.g. 1 or 0.5). Max 18 decimal places.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const fn = side === "YES" ? markets.stakeYes : markets.stakeNo;
      const res = await fn(marketId, amountWei);
      setTxHash(res.txHash);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Stake failed. Please try again.";
      setError(msg);
      setSubmitting(false);
    }
  }

  function handleFinalized(tx: Transaction) {
    if (tx.executionResult === "SUCCESS" && onSuccess) {
      setTimeout(onSuccess, 1200);
    }
  }

  const sideColor = side === "YES" ? "text-green" : "text-red";
  const sideBg = side === "YES"
    ? "bg-verdict-green hover:bg-verdict-green/90"
    : "bg-liquid-red hover:bg-liquid-red/90";

  const insufficientFunds = exceedsBalance();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-deep-ink/80 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-steel bg-obsidian p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-frost">
            Stake{" "}
            <span className={sideColor}>{side}</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:text-frost hover:bg-graphite transition-colors"
          >
            ✕
          </button>
        </div>

        {!txHash ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Wallet balance row */}
            {walletBalance && (
              <div className="flex items-center justify-between rounded-lg border border-steel bg-graphite px-3 py-2 text-xs">
                <span className="text-muted">Wallet balance</span>
                <span className="font-data text-frost">
                  {walletBalance.balanceGEN}{" "}
                  <span className="text-muted">GEN</span>
                </span>
              </div>
            )}

            <div>
              <label className="block text-sm text-muted mb-1.5">
                Amount (GEN)
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="decimal"
                  value={genInput}
                  onChange={(e) => {
                    setGenInput(e.target.value);
                    setError(null);
                  }}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-steel bg-graphite px-4 py-3 font-data text-lg text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none transition-colors"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-data text-sm text-muted">
                  GEN
                </span>
              </div>

              {/* Insufficient funds warning — informational only, does not block */}
              {insufficientFunds && (
                <p className="mt-2 rounded-lg border border-market-amber/30 bg-market-amber/10 px-3 py-2 text-xs text-amber">
                  This amount exceeds your wallet balance. The transaction may
                  fail on-chain — fund your wallet before staking.
                </p>
              )}

              {error && (
                <p className="mt-2 text-xs text-red">{error}</p>
              )}
            </div>

            <div className="rounded-xl border border-steel bg-graphite p-3">
              <p className="text-xs text-muted leading-relaxed">
                Your stake is sent to the KarionMarket contract and locked
                until the market resolves. The contract determines payouts —
                the backend does not.
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting || !genInput}
              className={`w-full rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-40 ${sideBg}`}
            >
              {submitting ? "Submitting…" : `Stake ${side}`}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Transaction submitted. Waiting for GenLayer consensus…
            </p>
            <TxPoller
              txHash={txHash}
              onFinalized={handleFinalized}
            />
            <button
              onClick={onClose}
              className="w-full rounded-xl border border-steel bg-graphite py-2.5 text-sm text-frost hover:border-blue-grey transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
