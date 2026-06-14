"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { auth } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function NavBar() {
  const { user, hydrated, setUser, setHydrated, clearUser } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (hydrated) return;
    auth
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setHydrated());
  }, [hydrated, setUser, setHydrated]);

  async function handleLogout() {
    try {
      await auth.logout();
    } finally {
      clearUser();
      router.push("/");
    }
  }

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={cn(
        "text-sm transition-colors hover:text-frost",
        pathname === href ? "text-frost" : "text-muted",
      )}
    >
      {label}
    </Link>
  );

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-steel bg-obsidian/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-display text-xl font-bold tracking-tight text-frost hover:opacity-80 transition-opacity"
        >
          Karion
        </Link>

        <div className="flex items-center gap-6">
          {navLink("/markets", "Markets")}
          {user && navLink("/portfolio", "Portfolio")}
          {user && navLink("/suggest", "Suggest")}
          {user && navLink("/resolution-centre", "Resolution")}
          {user && navLink("/profile", "Profile")}
          {user?.role === "ADMIN" && navLink("/admin/suggestions", "Admin")}

          {!hydrated ? (
            <div className="h-8 w-20 animate-pulse rounded-lg bg-graphite" />
          ) : user ? (
            <div className="flex items-center gap-4">
              <span className="hidden text-xs text-muted sm:block truncate max-w-[140px]">
                {user.email}
              </span>
              <button
                onClick={handleLogout}
                className="rounded-lg border border-steel bg-graphite px-3 py-1.5 text-sm text-frost transition-colors hover:border-blue-grey"
              >
                Log out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {navLink("/login", "Log in")}
              <Link
                href="/signup"
                className="rounded-lg bg-violet px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
