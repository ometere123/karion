"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/suggestions", label: "Suggestions" },
  { href: "/admin/markets", label: "Markets" },
  { href: "/admin/transactions", label: "Transactions" },
  { href: "/admin/activity", label: "Activity" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, hydrated } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!hydrated) return;
    if (!user || user.role !== "ADMIN") {
      router.replace("/");
    }
  }, [hydrated, user, router]);

  if (!hydrated) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <div className="h-6 w-32 animate-pulse rounded-lg bg-graphite" />
      </div>
    );
  }

  if (!user || user.role !== "ADMIN") return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Admin sub-nav */}
      <div className="mb-6 flex items-center gap-1 rounded-xl border border-steel bg-obsidian p-1">
        <span className="px-3 text-xs font-semibold uppercase tracking-widest text-muted">
          Admin
        </span>
        <div className="mx-2 h-4 w-px bg-steel" />
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
              pathname.startsWith(href)
                ? "bg-graphite text-frost"
                : "text-muted hover:text-frost",
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      {children}
    </div>
  );
}
