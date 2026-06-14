import Link from "next/link";

// Root layout already mounts <NavBar /> — no nav element here.

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-deep-ink">
      {/* Hero */}
      <section className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-6 text-center">
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-4 py-1.5 text-xs text-violet">
            <span className="inline-block h-2 w-2 rounded-full bg-violet" />
            GenLayer-powered prediction markets
          </div>

          <h1 className="font-display text-6xl font-bold leading-tight tracking-tight text-frost md:text-7xl lg:text-8xl">
            Karion
          </h1>

          <p className="mt-4 font-display text-xl text-violet md:text-2xl">
            Markets resolved by consensus
          </p>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            Stake GEN on real-world outcomes. GenLayer validators search web
            evidence, reason with LLMs, and settle markets by strict consensus.
            The backend only triggers transactions — it never decides outcomes.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/markets"
              className="rounded-xl bg-violet px-8 py-3.5 text-base font-semibold text-white transition-all hover:opacity-90 glow-violet"
            >
              Explore Markets
            </Link>
            <Link
              href="/suggest"
              className="rounded-xl border border-steel bg-graphite px-8 py-3.5 text-base font-semibold text-frost transition-all hover:border-blue-grey"
            >
              Suggest a Market
            </Link>
            <Link
              href="/resolution-centre"
              className="rounded-xl border border-violet/30 bg-violet/10 px-8 py-3.5 text-base font-semibold text-violet transition-all hover:bg-violet/20"
            >
              Resolution Centre
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-steel bg-obsidian py-24">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center font-display text-3xl font-bold text-frost">
            How Karion Works
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted">
            Every step from staking to payout is enforced on-chain. No backend
            administrator decides who wins.
          </p>

          <div className="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                step: "01",
                title: "Fund your wallet",
                desc: "Karion gives each user a non-custodial embedded wallet on StudioNet. Fund it with GEN from the faucet before staking.",
              },
              {
                step: "02",
                title: "Stake YES or NO",
                desc: "Browse markets and stake GEN on your predicted outcome. Stakes move from your wallet directly to the contract.",
              },
              {
                step: "03",
                title: "GenLayer resolves",
                desc: "Once a market closes, GenLayer validators fetch web evidence, reason with LLMs, and reach strict consensus on the outcome.",
              },
              {
                step: "04",
                title: "Winners claim",
                desc: "The contract issues payouts. Winners claim GEN from the contract. INVALID markets issue refunds. The backend never touches funds.",
              },
            ].map((item) => (
              <div key={item.step} className="text-left">
                <div className="font-data text-sm text-violet">{item.step}</div>
                <div className="mt-2 font-display text-lg font-semibold text-frost">
                  {item.title}
                </div>
                <div className="mt-1 text-sm leading-relaxed text-muted">
                  {item.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture guarantees */}
      <section className="py-24">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center font-display text-3xl font-bold text-frost">
            What Karion guarantees
          </h2>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <FeatureCard
              title="GenLayer resolves — not the backend"
              description="The backend submits the resolve transaction. GenLayer validators fetch evidence and reach consensus. The contract enforces the result. No admin can override it."
              accentColor="text-violet"
            />
            <FeatureCard
              title="Your wallet, your funds"
              description="Stakes move from your embedded wallet to the contract. Karion holds no custody. Payouts and refunds come directly from the contract to your wallet."
              accentColor="text-cyan"
            />
            <FeatureCard
              title="On-chain truth only"
              description="Cached database values are for display speed only. All claim eligibility, outcomes, and balances are read live from the contract."
              accentColor="text-green"
            />
          </div>

          {/* Architecture note */}
          <div className="mt-10 rounded-xl border border-steel bg-graphite px-6 py-5">
            <div className="grid gap-3 text-sm text-muted sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-violet">✓</span>
                <span>Backend only triggers transactions</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-violet">✓</span>
                <span>Contract state is authoritative</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-violet">✓</span>
                <span>GenLayer consensus decides outcomes</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-violet">✓</span>
                <span>Winners claim from the contract</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA footer band */}
      <section className="border-t border-steel bg-obsidian py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-2xl font-bold text-frost">
            Ready to stake?
          </h2>
          <p className="mt-3 text-sm text-muted">
            Browse open markets, fund your embedded wallet, and stake GEN on
            outcomes resolved by GenLayer consensus.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/markets"
              className="rounded-xl bg-violet px-8 py-3 text-sm font-semibold text-white transition-all hover:opacity-90"
            >
              Explore Markets
            </Link>
            <Link
              href="/signup"
              className="rounded-xl border border-steel bg-graphite px-8 py-3 text-sm font-semibold text-frost transition-all hover:border-blue-grey"
            >
              Create Account
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-steel py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="font-display text-sm text-muted">
            Karion &mdash; Markets resolved by consensus
          </div>
          <div className="flex flex-wrap items-center justify-center gap-5 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-verdict-green" />
              StudioNet &middot; Chain 61999
            </span>
            <span className="font-data">
              Contract: 0x90DEDD8b…747BF24
            </span>
            <Link href="/resolution-centre" className="hover:text-frost transition-colors">
              Resolution Centre
            </Link>
            <Link href="/markets" className="hover:text-frost transition-colors">
              Markets
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  title,
  description,
  accentColor,
}: {
  title: string;
  description: string;
  accentColor: string;
}) {
  return (
    <div className="rounded-xl border border-steel bg-graphite p-6 transition-colors hover:border-blue-grey">
      <h3 className={`font-display text-base font-semibold ${accentColor}`}>
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );
}
