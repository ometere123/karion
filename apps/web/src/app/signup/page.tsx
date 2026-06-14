"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Recovery key modal state
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const { setUser } = useAuthStore();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await auth.signup(email, password, confirmPassword);
      setUser(res.user);
      setRecoveryKey(res.recoveryKey);
      setWarning(res.recoveryKeyWarning);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  function handleDismissRecovery() {
    router.push("/markets");
  }

  // Recovery key modal — shown once after signup; user must acknowledge before continuing
  if (recoveryKey) {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-deep-ink px-4">
        <div className="w-full max-w-lg rounded-2xl border border-market-amber/40 bg-obsidian p-8">
          <div className="mb-4 flex items-center gap-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-market-amber/20 text-amber text-lg">
              !
            </span>
            <h2 className="font-display text-xl font-bold text-frost">
              Save your recovery key
            </h2>
          </div>

          {warning && (
            <p className="mb-4 text-sm text-amber">{warning}</p>
          )}

          <div className="rounded-xl border border-steel bg-graphite p-4 mb-6">
            <p className="font-data text-xs text-muted mb-2">Recovery Key</p>
            <p className="font-data text-sm text-frost break-all select-all leading-relaxed">
              {recoveryKey}
            </p>
          </div>

          <ul className="mb-6 space-y-1 text-sm text-muted list-disc list-inside">
            <li>This key is only shown once — copy it now.</li>
            <li>Store it somewhere safe and offline.</li>
            <li>It is the only way to recover your wallet if you lose access.</li>
          </ul>

          <button
            onClick={handleDismissRecovery}
            className="w-full rounded-xl bg-violet py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            I have saved my recovery key — Continue
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-deep-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-bold text-frost">
            Create account
          </h1>
          <p className="mt-2 text-sm text-muted">
            Start staking on real-world outcomes
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1.5">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-steel bg-graphite px-4 py-3 text-sm text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm text-muted mb-1.5">Password</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-steel bg-graphite px-4 py-3 text-sm text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none transition-colors"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-sm text-muted mb-1.5">Confirm password</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            disabled={loading}
            className="w-full rounded-xl bg-violet py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-frost hover:text-white transition-colors">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
