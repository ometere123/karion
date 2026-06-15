"use client";

import { useState, useEffect, useCallback } from "react";
import { admin, suggestions as suggApi } from "@/lib/api";
import type { AdminSuggestion, Attachment } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  "ALL",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "CREATED",
] as const;

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: "text-violet bg-violet/10 border-violet/30",
  UNDER_REVIEW: "text-amber bg-market-amber/10 border-market-amber/30",
  APPROVED: "text-green bg-verdict-green/10 border-verdict-green/30",
  REJECTED: "text-red bg-liquid-red/10 border-liquid-red/30",
  CHANGES_REQUESTED: "text-amber bg-market-amber/10 border-market-amber/30",
  CREATED: "text-frost bg-graphite border-steel",
  DRAFT: "text-muted bg-graphite border-steel",
};

type ActionState =
  | { type: "approve-and-create"; id: string; note: string }
  | { type: "reject"; id: string; note: string }
  | { type: "create"; id: string };

function AttachmentPanel({
  suggestionId,
}: {
  suggestionId: string;
}) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    suggApi
      .getAttachments(suggestionId)
      .then((res) => setAttachments(res.attachments))
      .catch(() => setError("Failed to load attachments"))
      .finally(() => setLoading(false));
  }, [suggestionId]);

  if (loading) {
    return (
      <div className="flex gap-2">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-16 w-16 animate-pulse rounded-lg bg-graphite" />
        ))}
      </div>
    );
  }

  if (error) return <p className="text-xs text-red">{error}</p>;

  if (!attachments?.length) {
    return (
      <p className="text-xs text-muted/60 italic">
        No attachments — user did not upload any files with this suggestion.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((a) =>
        a.fileType.startsWith("image/") ? (
          <a
            key={a.id}
            href={a.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.fileUrl}
              alt="Attachment"
              className="h-16 w-16 rounded-lg border border-steel object-cover transition-opacity hover:opacity-80"
            />
          </a>
        ) : (
          <a
            key={a.id}
            href={a.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-lg border border-steel bg-graphite text-muted transition-colors hover:border-violet/40"
            title="Open PDF"
          >
            <span className="text-2xl">📄</span>
            <span className="font-data text-xs">PDF</span>
          </a>
        ),
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-md border px-2 py-0.5 font-data text-xs",
        STATUS_COLORS[status] ?? "text-muted bg-graphite border-steel",
      )}
    >
      {status}
    </span>
  );
}

export default function AdminSuggestionsPage() {
  const [suggestions, setSuggestions] = useState<AdminSuggestion[]>([]);
  const [filter, setFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [openAttachmentsId, setOpenAttachmentsId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await admin.suggestions.list(
        filter === "ALL" ? undefined : filter,
      );
      setSuggestions(res.suggestions);
    } catch {
      setError("Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApproveAndCreate() {
    if (action?.type !== "approve-and-create") return;
    setSubmitting(true);
    setActionError(null);
    try {
      await admin.suggestions.approve(action.id, action.note || undefined);
      const res = await admin.suggestions.create(action.id);
      setActionSuccess(`Market created on-chain: ${res.market.onChainMarketId}`);
      setAction(null);
      load();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Action failed");
      load(); // reload — suggestion may now be APPROVED even if create failed
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (action?.type !== "reject") return;
    if (!action.note.trim()) {
      setActionError("Rejection reason is required");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      await admin.suggestions.reject(action.id, action.note);
      setActionSuccess("Suggestion rejected");
      setAction(null);
      load();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreate() {
    if (action?.type !== "create") return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await admin.suggestions.create(action.id);
      setActionSuccess(
        `Market created on-chain: ${res.market.onChainMarketId}`,
      );
      setAction(null);
      load();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Create market failed");
    } finally {
      setSubmitting(false);
    }
  }

  const canApproveReject = (s: AdminSuggestion) =>
    ["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED"].includes(s.status);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-frost">
          Suggestions
        </h1>
        <button
          onClick={load}
          className="rounded-lg border border-steel bg-graphite px-3 py-1.5 text-xs text-muted hover:text-frost transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Success toast */}
      {actionSuccess && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-verdict-green/30 bg-verdict-green/10 px-4 py-3">
          <span className="text-sm text-green">{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="text-muted hover:text-frost text-xs">✕</button>
        </div>
      )}

      {/* Status filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === s
                ? "border-violet bg-violet/10 text-violet"
                : "border-steel bg-graphite text-muted hover:text-frost",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-graphite" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-liquid-red/30 bg-liquid-red/5 px-6 py-8 text-center">
          <p className="text-sm text-red">{error}</p>
          <button
            onClick={load}
            className="mt-4 rounded-lg border border-steel bg-graphite px-4 py-2 text-xs text-muted hover:text-frost transition-colors"
          >
            ↻ Retry
          </button>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="rounded-xl border border-steel bg-obsidian px-6 py-12 text-center">
          <p className="text-sm text-muted">No suggestions found</p>
          <p className="mt-2 text-xs text-muted/60">
            {filter === "ALL"
              ? "Users haven't submitted any market suggestions yet."
              : `No suggestions with status "${filter}".`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {suggestions.map((s) => {
            const isActing = action !== null && action.id === s.id;
            return (
              <div
                key={s.id}
                className="rounded-xl border border-steel bg-obsidian"
              >
                {/* Row */}
                <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={s.status} />
                      <span className="font-data text-xs text-muted">
                        {s.category}
                      </span>
                      <span className="text-xs text-steel">·</span>
                      <span className="text-xs text-muted">
                        {s.suggestedBy.email}
                      </span>
                      <span className="text-xs text-steel">·</span>
                      <span className="text-xs text-muted">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-frost line-clamp-2">
                      {s.question}
                    </p>
                    {s.market && (
                      <p className="mt-1 font-data text-xs text-muted">
                        Market: {s.market.onChainMarketId} ({s.market.status})
                      </p>
                    )}
                    {s.reviewNotes && (
                      <p className="mt-1 text-xs text-muted italic">
                        Note: {s.reviewNotes}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      onClick={() =>
                        setOpenAttachmentsId(
                          openAttachmentsId === s.id ? null : s.id,
                        )
                      }
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        openAttachmentsId === s.id
                          ? "border-violet/40 bg-violet/10 text-violet"
                          : "border-steel bg-graphite text-muted hover:text-frost",
                      )}
                    >
                      Files
                    </button>
                    {s.status === "APPROVED" && !s.market && (
                      <button
                        onClick={() =>
                          setAction(
                            isActing && action.type === "create"
                              ? null
                              : { type: "create", id: s.id },
                          )
                        }
                        className="rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                      >
                        Create Market
                      </button>
                    )}
                    {canApproveReject(s) && (
                      <>
                        <button
                          onClick={() =>
                            setAction(
                              isActing && action.type === "approve-and-create"
                                ? null
                                : { type: "approve-and-create", id: s.id, note: "" },
                            )
                          }
                          className="rounded-lg border border-verdict-green/30 bg-verdict-green/10 px-3 py-1.5 text-xs font-medium text-green transition-colors hover:bg-verdict-green/20"
                        >
                          Approve &amp; Create
                        </button>
                        <button
                          onClick={() =>
                            setAction(
                              isActing && action.type === "reject"
                                ? null
                                : { type: "reject", id: s.id, note: "" },
                            )
                          }
                          className="rounded-lg border border-liquid-red/30 bg-liquid-red/10 px-3 py-1.5 text-xs font-medium text-red transition-colors hover:bg-liquid-red/20"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Attachment panel */}
                {openAttachmentsId === s.id && (
                  <div className="border-t border-steel px-5 py-4">
                    <p className="mb-3 text-xs font-medium text-muted uppercase tracking-wide">
                      Attachments
                    </p>
                    <AttachmentPanel suggestionId={s.id} />
                  </div>
                )}

                {/* Inline action panel */}
                {isActing && (
                  <div className="border-t border-steel px-5 py-4">
                    {actionError && (
                      <p className="mb-3 text-xs text-red">{actionError}</p>
                    )}

                    {action.type === "create" && (
                      <div className="space-y-3">
                        <p className="text-sm text-muted">
                          This will call{" "}
                          <code className="font-data text-xs text-frost">
                            create_market
                          </code>{" "}
                          on the KarionMarket contract. The action cannot be
                          undone. The transaction may take 30–90 seconds to
                          finalise.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={handleCreate}
                            disabled={submitting}
                            className="rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                          >
                            {submitting ? "Creating…" : "Confirm Create Market"}
                          </button>
                          <button
                            onClick={() => { setAction(null); setActionError(null); }}
                            className="rounded-lg border border-steel bg-graphite px-4 py-2 text-sm text-muted hover:text-frost transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {(action.type === "approve-and-create" || action.type === "reject") && (
                      <div className="space-y-3">
                        {action.type === "approve-and-create" && (
                          <p className="text-sm text-muted">
                            This will approve the suggestion and immediately call{" "}
                            <code className="font-data text-xs text-frost">create_market</code>{" "}
                            on-chain. The transaction may take 30–90 seconds to finalise.
                          </p>
                        )}
                        <label className="block text-sm text-muted">
                          {action.type === "reject"
                            ? "Rejection reason (required)"
                            : "Note for submitter (optional)"}
                        </label>
                        <textarea
                          value={action.note}
                          onChange={(e) =>
                            setAction({ ...action, note: e.target.value })
                          }
                          rows={2}
                          className="w-full rounded-xl border border-steel bg-graphite px-4 py-2.5 text-sm text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none"
                          placeholder={
                            action.type === "reject"
                              ? "Why is this being rejected?"
                              : "Optional note for the submitter…"
                          }
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={
                              action.type === "approve-and-create"
                                ? handleApproveAndCreate
                                : handleReject
                            }
                            disabled={submitting}
                            className={cn(
                              "rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40",
                              action.type === "approve-and-create"
                                ? "bg-verdict-green hover:opacity-90"
                                : "bg-liquid-red hover:opacity-90",
                            )}
                          >
                            {submitting
                              ? "Working…"
                              : action.type === "approve-and-create"
                                ? "Confirm Approve & Create"
                                : "Confirm Reject"}
                          </button>
                          <button
                            onClick={() => { setAction(null); setActionError(null); }}
                            className="rounded-lg border border-steel bg-graphite px-4 py-2 text-sm text-muted hover:text-frost transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
