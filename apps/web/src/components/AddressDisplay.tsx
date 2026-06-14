// AddressDisplay — shows a shortened address with a copy button.
// Address explorer links are NOT used because the StudioNet explorer's
// /address/{addr} endpoint has not been verified. Copy-only is safe.
"use client";

import CopyButton from "./CopyButton";
import { shortenAddress } from "@/lib/utils";
import { cn } from "@/lib/utils";

export default function AddressDisplay({
  address,
  label,
  chars = 6,
  className,
}: {
  address: string;
  label?: string;
  chars?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="font-data text-sm text-frost" title={address}>
        {shortenAddress(address, chars)}
      </span>
      <CopyButton text={address} label={label ?? "address"} />
    </span>
  );
}
