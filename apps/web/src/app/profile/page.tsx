"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, wallet } from "@/lib/api";
import type { WalletBalance } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { shortenAddress } from "@/lib/utils";
import type { User } from "@/types";
import CopyButton from "@/components/CopyButton";
import AddressDisplay from "@/components/AddressDisplay";

const CONTRACT_ADDRESS = "0x90DEDD8bCef8d0872f746cfb56D15E805747BF24";

interface RecoveryStatus {
  hasSystemRecovery: boolean;
  walletAddress: string;
  email: string;
}

export default function ProfilePage() {
  const { user, clearUser } = useAuthStore();
  const router = useRouter();

  const [fullUser, setFullUser] = useState<User | null>(null);
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      setBalance(await wallet.balance());
    } catch {
      setBalanceError("Could not fetch balance from StudioNet");
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, recoveryRes] = await Promise.all([
        auth.me(),
        auth.systemRecoveryStatus(),
      ]);
      setFullUser(meRes.user);
      setRecovery(recoveryRes);
      // Load balance after auth confirms we have a wallet
      loadBalance();
    } catch {
      setError("Could not load profile. Are you logged in?");
    } finally {
      setLoading(false);
    }
  }, [loadBalance]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleLogout() {
    try {
      await auth.logout();
    } finally {
      clearUser();
      router.push("/");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-graphite" />
          ))}
        </div>
      </main>
    );
  }

  if (error || !fullUser) {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
        <div className="text-center">
          <p className="text-muted">{error ?? "Not logged in"}</p>
          <Link
            href="/login"
            className="mt-4 inline-block rounded-xl bg-violet px-6 py-2.5 text-sm font-semibold text-white"
          >
            Log in
          </Link>
        </div>
      </main>
    );
  }

  const walletAddress = recovery?.walletAddress ?? user?.walletAddress ?? "";
  const joined = fullUser.createdAt
    ? new Date(fullUser.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-frost">Profile</h1>
        {joined && (
          <p className="mt-1 text-sm text-muted">Member since {joined}</p>
        )}
      </div>

      <div className="space-y-4">
        {/* Account card */}
        <section className="rounded-xl border border-steel bg-obsidian px-6 py-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted">
            Account
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Email</span>
              <span className="font-data text-sm text-frost">{fullUser.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Role</span>
              <span className="font-data text-xs uppercase tracking-wide text-muted">
                {fullUser.role}
              </span>
            </div>
          </div>
        </section>

        {/* Embedded wallet + balance card */}
        <section className="rounded-xl border border-steel bg-obsidian px-6 py-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted">
            Embedded Wallet
          </h2>

          <p className="mb-4 text-sm text-muted">
            Your Karion balance is your embedded wallet balance. Fund this
            wallet first, then stake from it. Karion holds no custody over your
            funds.
          </p>

          {walletAddress && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-steel bg-graphite px-4 py-3">
              <AddressDisplay address={walletAddress} label="wallet address" />
            </div>
          )}

          {/* Live balance */}
          <div className="rounded-lg border border-steel bg-graphite px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Balance</span>
              <div className="flex items-center gap-2">
                {balanceLoading ? (
                  <span className="h-5 w-24 animate-pulse rounded bg-steel" />
                ) : balanceError ? (
                  <span className="text-xs text-red">{balanceError}</span>
                ) : balance ? (
                  <span className="font-data text-sm font-semibold text-frost">
                    {balance.balanceGEN}{" "}
                    <span className="text-xs text-muted">GEN</span>
                  </span>
                ) : null}
                <button
                  onClick={loadBalance}
                  disabled={balanceLoading}
                  className="rounded-md border border-steel px-2 py-0.5 text-xs text-muted transition-colors hover:border-blue-grey hover:text-frost disabled:opacity-40"
                  title="Refresh balance"
                >
                  ↻
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Recovery status card */}
        <section className="rounded-xl border border-steel bg-obsidian px-6 py-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted">
            Recovery Status
          </h2>
          {recovery?.hasSystemRecovery ? (
            <div className="flex items-start gap-3 rounded-lg border border-verdict-green/25 bg-verdict-green/5 px-4 py-3">
              <span className="mt-0.5 text-lg leading-none text-green">✓</span>
              <div>
                <p className="text-sm font-medium text-green">
                  System recovery enabled
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  If you ever forget your password, it can be reset without
                  your recovery key. Your wallet address will be preserved
                  automatically.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-market-amber/25 bg-market-amber/5 px-4 py-3">
              <span className="mt-0.5 text-lg leading-none text-amber">!</span>
              <div>
                <p className="text-sm font-medium text-amber">
                  Recovery key required for password reset
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Your account was created before system recovery was
                  available. Keep your recovery key safe — you will need it
                  if you forget your password.
                </p>
                <p className="mt-2 text-xs text-muted">
                  Logging out and back in will upgrade your account
                  automatically.
                </p>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            Recovery key fallback is always available.{" "}
            <Link
              href="/forgot-password"
              className="text-frost underline underline-offset-2 hover:text-white"
            >
              Forgot password?
            </Link>
          </p>
        </section>

        {/* Fund wallet card */}
        <section className="rounded-xl border border-steel bg-obsidian px-6 py-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted">
            Fund Your Wallet
          </h2>
          <p className="mb-4 text-sm text-muted">
            Get test GEN tokens from the StudioNet faucet and send them to
            your embedded wallet address. Stake amounts move directly from
            your wallet to the contract on-chain.
          </p>
          <div className="space-y-3 rounded-lg border border-steel bg-graphite px-4 py-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Network</span>
              <span className="font-data text-frost">StudioNet</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Chain ID</span>
              <span className="font-data text-frost">61999</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Token</span>
              <span className="font-data text-frost">GEN</span>
            </div>
            <div className="flex items-center justify-between border-t border-steel pt-3">
              <span className="text-muted">Contract</span>
              <AddressDisplay address={CONTRACT_ADDRESS} label="contract address" />
            </div>
            {walletAddress && (
              <div className="flex items-center justify-between border-t border-steel pt-3">
                <span className="text-muted">Your wallet</span>
                <AddressDisplay address={walletAddress} label="wallet address" />
              </div>
            )}
          </div>
        </section>

        {/* Actions */}
        <section className="flex flex-col gap-3 rounded-xl border border-steel bg-obsidian px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <Link
              href="/portfolio"
              className="rounded-lg border border-steel bg-graphite px-4 py-2 text-sm text-frost transition-colors hover:border-blue-grey"
            >
              Portfolio
            </Link>
            <Link
              href="/markets"
              className="rounded-lg border border-steel bg-graphite px-4 py-2 text-sm text-frost transition-colors hover:border-blue-grey"
            >
              Markets
            </Link>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-liquid-red/30 bg-liquid-red/10 px-4 py-2 text-sm text-red transition-colors hover:bg-liquid-red/20"
          >
            Log out
          </button>
        </section>
      </div>
    </main>
  );
}
