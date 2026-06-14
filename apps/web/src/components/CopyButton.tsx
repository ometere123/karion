"use client";

import { useState } from "react";

export default function CopyButton({
  text,
  label,
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded-md border border-steel px-2 py-0.5 text-xs text-muted transition-colors hover:border-blue-grey hover:text-frost"
      title={label ? `Copy ${label}` : "Copy"}
      aria-label={label ? `Copy ${label}` : "Copy"}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
