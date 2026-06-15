"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { admin } from "@/lib/api";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "Politics",
  "Sports",
  "Economics",
  "Technology",
  "Science",
  "Crypto",
  "Entertainment",
  "Other",
];

interface FormState {
  question: string;
  category: string;
  yesCondition: string;
  noCondition: string;
  invalidCondition: string;
  resolutionUrl: string;
  resolutionQuery: string;
  resolutionDeadline: string;
}

const EMPTY: FormState = {
  question: "",
  category: "",
  yesCondition: "",
  noCondition: "",
  invalidCondition: "",
  resolutionUrl: "",
  resolutionQuery: "",
  resolutionDeadline: "",
};

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-frost">
        {label}
        {required && <span className="ml-1 text-liquid-red">*</span>}
      </label>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-steel bg-graphite px-4 py-2.5 text-sm text-frost placeholder-blue-grey/50 focus:border-blue-grey focus:outline-none transition-colors";

export default function CreateMarketPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ marketId: string; txHash: string } | null>(null);

  function set(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const deadline = new Date(form.resolutionDeadline).toISOString();
      const res = await admin.markets.directCreate({
        ...form,
        resolutionDeadline: deadline,
      });
      setSuccess({ marketId: res.market.onChainMarketId, txHash: res.txHash });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create market");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-2xl border border-verdict-green/30 bg-verdict-green/10 px-6 py-8 text-center">
          <div className="mb-3 text-3xl">✓</div>
          <h2 className="font-display text-xl font-bold text-frost">Market Created</h2>
          <p className="mt-2 text-sm text-muted">
            On-chain market ID:{" "}
            <span className="font-data text-frost">{success.marketId}</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            Tx:{" "}
            <span className="font-data text-xs">{success.txHash.slice(0, 20)}…</span>
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => { setSuccess(null); setForm(EMPTY); }}
              className="rounded-lg border border-steel bg-graphite px-4 py-2 text-sm text-frost hover:border-blue-grey transition-colors"
            >
              Create Another
            </button>
            <Link
              href="/admin/markets"
              className="rounded-lg bg-violet px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              Back to Markets
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/admin/markets"
          className="text-sm text-muted hover:text-frost transition-colors"
        >
          ← Markets
        </Link>
        <span className="text-steel">/</span>
        <h1 className="font-display text-2xl font-bold text-frost">Create Market</h1>
      </div>

      <div className="rounded-2xl border border-steel bg-obsidian px-6 py-6">
        <p className="mb-6 text-sm text-muted">
          Creates a market on-chain directly — no suggestion required. The transaction
          waits for GenLayer finality (30–90 s). All fields are passed verbatim to the
          contract and the AI resolver.
        </p>

        {error && (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-liquid-red/30 bg-liquid-red/10 px-4 py-3">
            <p className="text-sm text-red">{error}</p>
            <button onClick={() => setError(null)} className="shrink-0 text-xs text-muted hover:text-frost">✕</button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Question" required hint="The market question shown to users.">
            <textarea
              value={form.question}
              onChange={(e) => set("question", e.target.value)}
              required
              rows={3}
              minLength={10}
              maxLength={500}
              placeholder="Will X happen before Y date?"
              className={inputCls}
            />
          </Field>

          <Field label="Category" required>
            <select
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              required
              className={cn(inputCls, "cursor-pointer")}
            >
              <option value="" disabled>Select a category…</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="YES Condition" required hint="When YES wins.">
              <textarea
                value={form.yesCondition}
                onChange={(e) => set("yesCondition", e.target.value)}
                required
                rows={3}
                minLength={5}
                maxLength={500}
                placeholder="X happens…"
                className={inputCls}
              />
            </Field>
            <Field label="NO Condition" required hint="When NO wins.">
              <textarea
                value={form.noCondition}
                onChange={(e) => set("noCondition", e.target.value)}
                required
                rows={3}
                minLength={5}
                maxLength={500}
                placeholder="X does not happen…"
                className={inputCls}
              />
            </Field>
            <Field label="INVALID Condition" required hint="When market is voided.">
              <textarea
                value={form.invalidCondition}
                onChange={(e) => set("invalidCondition", e.target.value)}
                required
                rows={3}
                minLength={5}
                maxLength={500}
                placeholder="Question becomes unanswerable…"
                className={inputCls}
              />
            </Field>
          </div>

          <Field
            label="Resolution URL"
            required
            hint="The primary URL the GenLayer AI will fetch to determine the outcome."
          >
            <input
              type="url"
              value={form.resolutionUrl}
              onChange={(e) => set("resolutionUrl", e.target.value)}
              required
              maxLength={2000}
              placeholder="https://example.com/results"
              className={inputCls}
            />
          </Field>

          <Field
            label="Resolution Query"
            required
            hint="The question or search query sent to the AI resolver."
          >
            <textarea
              value={form.resolutionQuery}
              onChange={(e) => set("resolutionQuery", e.target.value)}
              required
              rows={3}
              minLength={10}
              maxLength={1000}
              placeholder="Did X happen? Look for official announcements at the resolution URL."
              className={inputCls}
            />
          </Field>

          <Field
            label="Resolution Deadline"
            required
            hint="Date and time after which the market can be locked and resolved."
          >
            <input
              type="datetime-local"
              value={form.resolutionDeadline}
              onChange={(e) => set("resolutionDeadline", e.target.value)}
              required
              className={inputCls}
            />
          </Field>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? "Creating… (waiting for chain)" : "Create Market On-Chain"}
            </button>
            <Link
              href="/admin/markets"
              className="rounded-lg border border-steel bg-graphite px-5 py-2.5 text-sm text-muted hover:text-frost transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
