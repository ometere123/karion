import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

// All on-chain and API amounts are wei strings — always divide by 1e18.
export function formatGEN(amount: string | number | bigint): string {
  const num =
    typeof amount === "bigint"
      ? Number(amount) / 1e18
      : typeof amount === "string"
        ? Number(amount) / 1e18
        : amount; // number callers are assumed to already be in GEN units
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(num);
}

export function formatDeadline(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function getMarketStatusColor(status: string): string {
  switch (status) {
    case "OPEN":
      return "text-cyan";
    case "LOCKED":
      return "text-amber";
    case "RESOLVING":
      return "text-violet";
    case "RESOLVED":
      return "text-green";
    case "INVALID":
      return "text-red";
    case "CANCELLED":
      return "text-red";
    default:
      return "text-muted";
  }
}

export function getOutcomeColor(outcome: string): string {
  switch (outcome) {
    case "YES":
      return "text-green";
    case "NO":
      return "text-red";
    case "INVALID":
      return "text-amber";
    default:
      return "text-muted";
  }
}
