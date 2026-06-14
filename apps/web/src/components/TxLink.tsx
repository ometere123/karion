"use client";

import { useState } from "react";

const EXPLORER_TX = "https://explorer-studio.genlayer.com/tx";

export default function TxLink({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={`${EXPLORER_TX}/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-data text-xs text-muted hover:text-violet transition-colors"
        title={`View on StudioNet Explorer\n${hash}`}
      >
        {hash.slice(0, 10)}…{hash.slice(-6)} ⬡
      </a>
      <button
        onClick={handleCopy}
        className="text-muted hover:text-frost transition-colors text-xs leading-none"
        title="Copy tx hash"
        aria-label="Copy transaction hash"
      >
        {copied ? "✓" : "⎘"}
      </button>
    </span>
  );
}
