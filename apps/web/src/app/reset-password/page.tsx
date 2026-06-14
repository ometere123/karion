"use client";

// /reset-password?token=<64-hex-char-token>
//
// Two outcomes from POST /auth/reset-password:
//   walletAutoRecovered: true  — SYSTEM wrap decrypted WEK, re-wrapped with new
//                                password, session created. User is logged in.
//                                Wallet address is unchanged.
//   walletAutoRecovered: false — No SYSTEM wrap (old account). Password updated
//                                but user must use their recovery key via
//                                /auth/recover-wallet to restore wallet access.

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

type Stage = "form" | "loading" | "success" | "needs-recovery-key" | "error";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordSkeleton />}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordSkeleton() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-deep-ink px-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="h-8 w-48 mx-auto animate-pulse rounded-lg bg-graphite" />
        <div className="h-12 animate-pulse rounded-xl bg-graphite" />
        <div className="h-12 animate-pulse rounded-xl bg-graphite" />
        <div className="h-12 animate-pulse rounded-xl bg-graphite" />
      </div>
    </main>
  );
}

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setUser } = useAuthStore();

  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || token.length !== 64) {
      setError("Invalid or missing reset token. Please request a new reset link.");
      setStage("error");
    }
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setStage("loading");
    try {
      const result = await auth.resetPassword(token, newPassword);

      if (result.walletAutoRecovered && result.user) {
        setUser(result.user);
        setStage("success");
        // Redirect after short delay so user sees the confirmation
        setTimeout(() => router.push("/markets"), 2500);
      } else {
        setStage("needs-recovery-key");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed");
      setStage("error");
    }
  }

  if (stage === "success") {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-deep-ink px-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-verdict-green/20 text-3xl text-green">
            ✓
          </div>
          <h1 className="font-display text-2xl font-bold text-frost">
            Password reset
          </h1>
          <p className="mt-3 text-sm text-muted">
            Your password has been updated and your wallet address is
            unchanged. Redirecting you to markets…
          </p>
          <div className="mt-6 rounded-xl border border-verdict-green/20 bg-verdict-green/5 px-4 py-3">
            <p className="font-data text-xs text-green">
              Wallet auto-recovered via system wrap. No recovery key needed.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (stage === "needs-recovery-key") {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-deep-ink px-4">
        <div className="w-full max-w-md">
          <div className="mb-4 flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-market-amber/20 text-amber text-xl">
              !
            </span>
            <h1 className="font-display text-2xl font-bold text-frost">
              Password updated
            </h1>
          </div>
          <p className="mb-4 text-sm text-muted">
            Your password was reset, but your account was created before
            the system recovery upgrade. To restore full wallet access,
            you need to log in and then use your recovery key.
          </p>
          <ol className="mb-6 space-y-2 text-sm text-muted list-decimal list-inside">
            <li>Log in with your new password</li>
            <li>Go to Wallet → Restore Access</li>
            <li>Enter your 64-character recovery key</li>
          </ol>
          <Link
            href="/login"
            className="block w-full rounded-xl bg-violet py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Log in now
          </Link>
        </div>
      </main>
    );
  }

  if (stage === "error") {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-deep-ink px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-liquid-red/20 text-3xl text-red">
            ✕
          </div>
          <h1 className="font-display text-2xl font-bold text-frost">
            Reset failed
          </h1>
          <p className="mt-3 text-sm text-muted">
            {error ?? "This reset link is invalid or has expired."}
          </p>
          <Link
            href="/forgot-password"
            className="mt-8 inline-block rounded-xl bg-violet px-8 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-deep-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-bold text-frost">
            Set new password
          </h1>
          <p className="mt-2 text-sm text-muted">
            Choose a strong password for your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1.5">
              New password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setError(null);
              }}
              className="w-full rounded-xl border border-steel bg-graphite px-4 py-3 text-sm text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none transition-colors"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-sm text-muted mb-1.5">
              Confirm password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError(null);
              }}
              className="w-full rounded-xl border border-steel bg-graphite px-4 py-3 text-sm text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-xl border border-liquid-red/30 bg-liquid-red/10 px-4 py-2.5 text-sm text-red">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={stage === "loading" || !token}
            className="w-full rounded-xl bg-violet py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {stage === "loading" ? "Resetting…" : "Reset password"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          <Link
            href="/forgot-password"
            className="text-frost hover:text-white transition-colors"
          >
            Request a new link
          </Link>
        </p>
      </div>
    </main>
  );
}
