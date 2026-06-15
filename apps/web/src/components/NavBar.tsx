"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { auth } from "@/lib/api";
import { cn } from "@/lib/utils";

function KMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="#07111F" />
      <rect x="6" y="6" width="4.5" height="20" rx="2" fill="#6D5DF6" />
      <line x1="10.5" y1="16" x2="25" y2="6" stroke="#6D5DF6" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="10.5" y1="16" x2="25" y2="26" stroke="#22D3EE" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("karion-theme");
    const initial = saved === "light" ? "light" : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    setMounted(true);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("karion-theme", next);
    document.documentElement.dataset.theme = next;
  }

  if (!mounted) return <div className="h-8 w-8 shrink-0" />;

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-steel bg-graphite text-muted transition-colors hover:text-frost"
    >
      {theme === "dark" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

export default function NavBar() {
  const { user, hydrated, setUser, setHydrated, clearUser } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    auth
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setHydrated());
  }, [hydrated, setUser, setHydrated]);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    try {
      await auth.logout();
    } finally {
      clearUser();
      router.push("/");
    }
  }

  const isAdmin = user?.role === "ADMIN";

  const link = (href: string, label: string, active?: boolean) => (
    <Link
      href={href}
      className={cn(
        "text-sm transition-colors hover:text-frost",
        (active ?? pathname === href) ? "text-frost font-medium" : "text-muted",
      )}
    >
      {label}
    </Link>
  );

  const coreLinks = (
    <>
      {link("/markets", "Markets")}
      {user && link("/portfolio", "Portfolio")}
      {user && !isAdmin && link("/suggest", "Suggest")}
      {user && link("/resolution-centre", "Resolution")}
      {user && link("/profile", "Profile")}
      {isAdmin && link("/admin/suggestions", "Admin", pathname.startsWith("/admin"))}
    </>
  );

  const authSection = !hydrated ? (
    <div className="h-8 w-20 animate-pulse rounded-lg bg-graphite" />
  ) : user ? (
    <div className="flex items-center gap-3">
      <span className="hidden text-xs text-muted lg:block truncate max-w-[160px]">
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
      {link("/login", "Log in")}
      <Link
        href="/signup"
        className="rounded-lg bg-violet px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Sign up
      </Link>
    </div>
  );

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-steel bg-obsidian/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <KMark />
          <span className="font-display text-xl font-bold tracking-tight text-frost">
            Karion
          </span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden items-center gap-6 md:flex">
          {coreLinks}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <ThemeToggle />

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-3">
            {authSection}
          </div>

          {/* Hamburger (mobile only) */}
          <button
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-steel bg-graphite text-muted transition-colors hover:text-frost md:hidden"
          >
            {mobileOpen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="border-t border-steel bg-obsidian/95 px-4 pb-5 pt-3 md:hidden">
          <div className="flex flex-col gap-1">
            <nav className="flex flex-col gap-4 py-2">
              {coreLinks}
            </nav>
            <div className="border-t border-steel pt-4">
              {authSection}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
