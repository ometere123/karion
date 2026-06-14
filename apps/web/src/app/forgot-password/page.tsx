"use client";

import { useState } from "react";
import Link from "next/link";
import { auth } from "@/lib/api";

type State = "idle" | "loading" | "sent" | "error";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrorMsg(null);
    try {
      await auth.forgotPassword(email);
      setState("sent");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Request failed");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-deep-ink px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-signal-cyan/20 text-3xl text-cyan">
            ✉
          </div>
          <h1 className="font-display text-2xl font-bold text-frost">
            Check your email
          </h1>
          <p className="mt-3 text-sm text-muted">
            If{" "}
            <span className="text-frost">{email}</span> is registered, a
            password reset link has been sent. It expires in 1 hour.
          </p>
          <p className="mt-4 text-xs text-muted">
            No email? Check your spam folder, or{" "}
            <button
              onClick={() => {
                setState("idle");
                setEmail("");
              }}
              className="text-frost hover:text-white transition-colors"
            >
              try again
            </button>
            .
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-deep-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-bold text-frost">
            Reset password
          </h1>
          <p className="mt-2 text-sm text-muted">
            Enter your email and we'll send a reset link
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
              onChange={(e) => {
                setEmail(e.target.value);
                if (state === "error") setState("idle");
              }}
              className="w-full rounded-xl border border-steel bg-graphite px-4 py-3 text-sm text-frost placeholder-muted/40 focus:border-blue-grey focus:outline-none transition-colors"
              placeholder="you@example.com"
            />
          </div>

          {state === "error" && errorMsg && (
            <p className="rounded-xl border border-liquid-red/30 bg-liquid-red/10 px-4 py-2.5 text-sm text-red">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={state === "loading"}
            className="w-full rounded-xl bg-violet py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {state === "loading" ? "Sending…" : "Send reset link"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Remembered it?{" "}
          <Link href="/login" className="text-frost hover:text-white transition-colors">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
