"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { suggestions } from "@/lib/api";
import type { SuggestionPayload } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { useUploadThing } from "@/lib/uploadthing";

const CATEGORIES = [
  "Politics",
  "Sports",
  "Technology",
  "Finance",
  "Science",
  "Entertainment",
  "Other",
];

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-frost mb-1">{label}</label>
      {hint && <p className="mb-1.5 text-xs text-muted">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-steel bg-graphite px-4 py-3 text-sm text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none transition-colors";
const textareaCls = `${inputCls} resize-none`;

// ── Attachment uploader (shown after form submit) ──────────────────────────────

function SuggestionUploader({
  suggestionId,
  onDone,
}: {
  suggestionId: string;
  onDone: () => void;
}) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ url: string; type: string }>>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { startUpload, isUploading } = useUploadThing("suggestionAttachment", {
    onClientUploadComplete: async (uploaded) => {
      for (const file of uploaded) {
        try {
          await suggestions.saveAttachment(suggestionId, {
            fileUrl: file.url,
            fileKey: file.key,
            fileType: file.type ?? "application/octet-stream",
            fileSize: file.size,
          });
          setUploadedFiles((prev) => [
            ...prev,
            { url: file.url, type: file.type ?? "" },
          ]);
        } catch {
          // individual file save error is non-fatal
        }
      }
      setSelectedFiles([]);
    },
    onUploadError: (err) => setUploadError(err.message),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length + uploadedFiles.length > 4) {
      setUploadError("Maximum 4 files total");
      e.target.value = "";
      return;
    }
    setUploadError(null);
    setSelectedFiles(files);
  }

  async function handleUpload() {
    if (!selectedFiles.length || isUploading) return;
    setUploadError(null);
    await startUpload(selectedFiles, { suggestionId });
  }

  const isImage = (type: string) => type.startsWith("image/");

  return (
    <div className="w-full max-w-md">
      {/* Uploaded previews */}
      {uploadedFiles.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {uploadedFiles.map((f, i) =>
            isImage(f.type) ? (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.url}
                  alt={`Attachment ${i + 1}`}
                  className="h-20 w-20 rounded-lg border border-steel object-cover"
                />
              </a>
            ) : (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-20 w-20 items-center justify-center rounded-lg border border-steel bg-graphite text-3xl text-muted hover:border-violet/40 transition-colors"
                title="Open PDF"
              >
                📄
              </a>
            ),
          )}
        </div>
      )}

      {uploadedFiles.length < 4 && (
        <>
          {/* Drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="mb-3 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-steel bg-graphite px-6 py-8 text-center transition-colors hover:border-violet/40 hover:bg-graphite/80"
          >
            <span className="text-2xl text-muted">+</span>
            <p className="text-sm text-muted">
              {selectedFiles.length > 0
                ? `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected`
                : "Click to select files"}
            </p>
            <p className="text-xs text-muted/60">
              Images and PDFs · max {4 - uploadedFiles.length} more · 4MB each
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {selectedFiles.length > 0 && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="mb-3 w-full rounded-xl border border-violet/30 bg-violet/10 py-2.5 text-sm font-semibold text-violet transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {isUploading ? "Uploading…" : `Upload ${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""}`}
            </button>
          )}
        </>
      )}

      {uploadError && (
        <p className="mb-3 rounded-xl border border-liquid-red/30 bg-liquid-red/10 px-4 py-2.5 text-sm text-red">
          {uploadError}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onDone}
          className="flex-1 rounded-xl bg-violet py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Done — view markets
        </button>
        {uploadedFiles.length === 0 && !isUploading && (
          <button
            onClick={onDone}
            className="rounded-xl border border-steel bg-graphite px-5 py-3 text-sm text-muted transition-colors hover:text-frost"
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function SuggestPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<SuggestionPayload>({
    question: "",
    category: "Other",
    yesCondition: "",
    noCondition: "",
    invalidCondition: "",
    resolutionUrl: "",
    resolutionQuery: "",
    resolutionDeadline: "",
    sourcePolicy: "",
    evidencePriority: "",
  });

  function update(field: keyof SuggestionPayload, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      router.push("/login");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const payload: SuggestionPayload = { ...form };
      if (!payload.sourcePolicy) delete payload.sourcePolicy;
      if (!payload.evidencePriority) delete payload.evidencePriority;
      const res = await suggestions.submit(payload);
      setSubmittedId(res.suggestion.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  if (submittedId) {
    return (
      <main className="min-h-screen bg-deep-ink flex items-center justify-center px-4">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-verdict-green/20 text-3xl text-green">
            ✓
          </div>
          <h1 className="font-display text-2xl font-bold text-frost">
            Suggestion submitted
          </h1>
          <p className="mt-3 text-sm text-muted">
            Your suggestion is under review. Add supporting files below, or skip
            to markets.
          </p>

          <div className="mt-8 w-full">
            <p className="mb-4 text-left text-sm font-medium text-frost">
              Add supporting files{" "}
              <span className="text-muted font-normal">(optional)</span>
            </p>
            <SuggestionUploader
              suggestionId={submittedId}
              onDone={() => router.push("/markets")}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-deep-ink">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-frost">Suggest a Market</h1>
          <p className="mt-2 text-sm text-muted">
            Propose a real-world question for GenLayer to resolve by consensus.
          </p>
        </div>

        {!user && (
          <div className="mb-6 rounded-xl border border-market-amber/30 bg-market-amber/10 px-4 py-3 text-sm text-amber">
            You must be{" "}
            <a href="/login" className="underline hover:text-frost transition-colors">
              logged in
            </a>{" "}
            to submit a suggestion.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <FieldGroup
            label="Question"
            hint="A clear, binary yes/no question about a real-world outcome."
          >
            <textarea
              required
              rows={3}
              value={form.question}
              onChange={(e) => update("question", e.target.value)}
              placeholder="Will Bitcoin reach $200,000 by December 31 2025?"
              className={textareaCls}
            />
          </FieldGroup>

          <FieldGroup label="Category">
            <select
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
              className={inputCls}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FieldGroup>

          <FieldGroup
            label="YES condition"
            hint="Exact condition that makes this market resolve YES."
          >
            <textarea
              required
              rows={2}
              value={form.yesCondition}
              onChange={(e) => update("yesCondition", e.target.value)}
              placeholder="Bitcoin's spot price on a major exchange exceeds $200,000 before the deadline."
              className={textareaCls}
            />
          </FieldGroup>

          <FieldGroup
            label="NO condition"
            hint="Exact condition that makes this market resolve NO."
          >
            <textarea
              required
              rows={2}
              value={form.noCondition}
              onChange={(e) => update("noCondition", e.target.value)}
              placeholder="Bitcoin's price remains below $200,000 through the deadline."
              className={textareaCls}
            />
          </FieldGroup>

          <FieldGroup
            label="Invalid condition"
            hint="Conditions under which the market should be invalidated and refunded."
          >
            <textarea
              required
              rows={2}
              value={form.invalidCondition}
              onChange={(e) => update("invalidCondition", e.target.value)}
              placeholder="The question becomes unanswerable or reliable price data is unavailable."
              className={textareaCls}
            />
          </FieldGroup>

          <FieldGroup
            label="Resolution URL"
            hint="Primary source URL that GenLayer should fetch to resolve this market."
          >
            <input
              type="url"
              required
              value={form.resolutionUrl}
              onChange={(e) => update("resolutionUrl", e.target.value)}
              placeholder="https://api.coinbase.com/v2/prices/BTC-USD/spot"
              className={inputCls}
            />
          </FieldGroup>

          <FieldGroup
            label="Resolution query"
            hint="What should GenLayer look for at the resolution URL?"
          >
            <textarea
              required
              rows={2}
              value={form.resolutionQuery}
              onChange={(e) => update("resolutionQuery", e.target.value)}
              placeholder="Check if the current BTC/USD spot price exceeds 200000."
              className={textareaCls}
            />
          </FieldGroup>

          <FieldGroup
            label="Resolution deadline"
            hint="ISO 8601 datetime — e.g. 2025-12-31T23:59:59Z"
          >
            <input
              type="datetime-local"
              required
              value={form.resolutionDeadline.replace("Z", "")}
              onChange={(e) =>
                update("resolutionDeadline", e.target.value ? `${e.target.value}:00Z` : "")
              }
              className={inputCls}
            />
          </FieldGroup>

          <FieldGroup
            label="Source policy (optional)"
            hint="How should GenLayer weight different sources?"
          >
            <input
              type="text"
              value={form.sourcePolicy ?? ""}
              onChange={(e) => update("sourcePolicy", e.target.value)}
              placeholder="Prefer official exchange APIs over aggregators."
              className={inputCls}
            />
          </FieldGroup>

          <FieldGroup
            label="Evidence priority (optional)"
            hint="What kind of evidence should GenLayer prioritise?"
          >
            <input
              type="text"
              value={form.evidencePriority ?? ""}
              onChange={(e) => update("evidencePriority", e.target.value)}
              placeholder="Real-time price data, then historical close."
              className={inputCls}
            />
          </FieldGroup>

          {error && (
            <p className="rounded-xl border border-liquid-red/30 bg-liquid-red/10 px-4 py-2.5 text-sm text-red">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !user}
            className="w-full rounded-xl bg-violet py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Submitting…" : "Submit suggestion"}
          </button>
        </form>
      </div>
    </main>
  );
}
