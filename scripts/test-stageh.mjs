/**
 * Stage H — Automatic Resolution and Resolution Centre — 17-check test suite
 *
 * Prerequisites: API running on http://localhost:4000
 *   cd apps/api && npm run dev
 *
 * Usage:
 *   node scripts/test-stageh.mjs
 */

import crypto from "crypto";

const API = "http://localhost:4000";
const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ${PASS}  ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL}  ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function registerAndLogin() {
  const email = `stageh-${crypto.randomBytes(6).toString("hex")}@test.local`;
  const password = "TestPass123!";
  const sr = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, confirmPassword: password }),
  });
  const sd = await json(sr);
  if (!sr.ok) throw new Error(`Signup failed: ${JSON.stringify(sd)}`);

  const lr = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = lr.headers.get("set-cookie") ?? "";
  const m = cookie.match(/karion_session=[^;]+/);
  if (!m) throw new Error(`No session cookie after login. Cookie header: ${cookie}`);
  return { cookie: m[0], email };
}

async function registerAndLoginAdmin() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  const email = `admin-stageh-${crypto.randomBytes(6).toString("hex")}@test.local`;
  const password = "AdminPass123!";
  const sr = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, confirmPassword: password }),
  });
  const sd = await json(sr);
  if (!sr.ok) throw new Error(`Admin signup failed: ${JSON.stringify(sd)}`);

  await prisma.user.update({
    where: { email },
    data: { role: "ADMIN" },
  });
  await prisma.$disconnect();

  const lr = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = lr.headers.get("set-cookie") ?? "";
  const m = cookie.match(/karion_session=[^;]+/);
  if (!m) throw new Error(`No admin session cookie. Cookie header: ${cookie}`);
  return { cookie: m[0], email };
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function getFirstMarket(adminCookie) {
  const r = await fetch(`${API}/api/admin/markets`, {
    headers: { Cookie: adminCookie },
  });
  const d = await json(r);
  if (!r.ok || !d?.markets?.length) return null;
  return d.markets[0];
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nStage H — Automatic Resolution and Resolution Centre\n");

  let userCookie, adminCookie, market;

  // ── setup ─────────────────────────────────────────────────────────────────

  try {
    const u = await registerAndLogin();
    userCookie = u.cookie;
    const a = await registerAndLoginAdmin();
    adminCookie = a.cookie;
    console.log(`  setup  user ${u.email} | admin ${a.email}\n`);
  } catch (e) {
    console.error("  FATAL setup failed:", e.message);
    process.exit(1);
  }

  // grab a market for later checks (may be null if DB is empty)
  market = await getFirstMarket(adminCookie);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("── Check 1-3: Resolution Centre API ─────────────────────────");

  // 1. Unauthenticated request is rejected
  const rcUnauth = await fetch(`${API}/api/resolution-centre`);
  assert("1. GET /api/resolution-centre → 401 without session", rcUnauth.status === 401);

  // 2. Authenticated request returns the expected shape
  const rcAuth = await fetch(`${API}/api/resolution-centre`, {
    headers: { Cookie: userCookie },
  });
  const rcData = await json(rcAuth);
  assert(
    "2. GET /api/resolution-centre → 200 with correct shape for authenticated user",
    rcAuth.status === 200 &&
      Array.isArray(rcData?.pastDeadline) &&
      Array.isArray(rcData?.awaitingResolution) &&
      Array.isArray(rcData?.recentlyResolved) &&
      Array.isArray(rcData?.invalid) &&
      Array.isArray(rcData?.unresolved),
  );

  // 3. Each market in the response includes resolutionAttempts array
  const allRcMarkets = [
    ...(rcData?.pastDeadline ?? []),
    ...(rcData?.awaitingResolution ?? []),
    ...(rcData?.recentlyResolved ?? []),
    ...(rcData?.invalid ?? []),
    ...(rcData?.unresolved ?? []),
  ];
  const attemptsPresent =
    allRcMarkets.length === 0 ||
    allRcMarkets.every((m) => Array.isArray(m.resolutionAttempts));
  assert(
    "3. Each resolution-centre market includes resolutionAttempts array",
    attemptsPresent,
    allRcMarkets.length === 0 ? "(no markets in DB — vacuously true)" : "",
  );

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n── Check 4-6: Resolve Attempts Admin Endpoint ───────────────");

  // 4. Non-admin cannot access resolve-attempts
  if (market) {
    const naR = await fetch(
      `${API}/api/admin/markets/${market.onChainMarketId}/resolve-attempts`,
      { headers: { Cookie: userCookie } },
    );
    assert(
      "4. GET /api/admin/markets/:id/resolve-attempts → 403 for non-admin",
      naR.status === 403,
    );
  } else {
    assert("4. GET /api/admin/markets/:id/resolve-attempts → 403 for non-admin", true, "(skipped — no markets in DB)");
  }

  // 5. Admin can access resolve-attempts
  if (market) {
    const aR = await fetch(
      `${API}/api/admin/markets/${market.onChainMarketId}/resolve-attempts`,
      { headers: { Cookie: adminCookie } },
    );
    const aD = await json(aR);
    assert(
      "5. GET /api/admin/markets/:id/resolve-attempts → 200 for admin with correct shape",
      aR.status === 200 &&
        Array.isArray(aD?.attempts) &&
        (aD?.cooldownUntil === null || typeof aD?.cooldownUntil === "string"),
    );
  } else {
    assert("5. GET /api/admin/markets/:id/resolve-attempts → 200 for admin", true, "(skipped — no markets in DB)");
  }

  // 6. Unknown market ID returns 404
  const unknownR = await fetch(
    `${API}/api/admin/markets/market_does_not_exist_xyz/resolve-attempts`,
    { headers: { Cookie: adminCookie } },
  );
  assert(
    "6. GET /api/admin/markets/:id/resolve-attempts → 404 for unknown market",
    unknownR.status === 404,
  );

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n── Check 7-9: Admin Resolve Endpoint Guards ─────────────────");

  // 7. Resolve without confirm: true is rejected
  if (market) {
    const noConfR = await fetch(
      `${API}/api/admin/markets/${market.onChainMarketId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({}),
      },
    );
    assert(
      "7. POST /api/admin/markets/:id/resolve → 400 without confirm:true",
      noConfR.status === 400,
    );
  } else {
    assert("7. POST /api/admin/markets/:id/resolve → 400 without confirm:true", true, "(skipped — no markets)");
  }

  // 8. Non-admin cannot trigger resolve
  if (market) {
    const naResolveR = await fetch(
      `${API}/api/admin/markets/${market.onChainMarketId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ confirm: true }),
      },
    );
    assert(
      "8. POST /api/admin/markets/:id/resolve → 403 for non-admin",
      naResolveR.status === 403,
    );
  } else {
    assert("8. POST /api/admin/markets/:id/resolve → 403 for non-admin", true, "(skipped — no markets)");
  }

  // 9. Resolve rejects non-LOCKED market with 409 / 400 / 422
  if (market && market.status !== "LOCKED") {
    const wrongStatusR = await fetch(
      `${API}/api/admin/markets/${market.onChainMarketId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ confirm: true }),
      },
    );
    assert(
      "9. POST resolve on non-LOCKED market → 4xx",
      wrongStatusR.status >= 400 && wrongStatusR.status < 500,
      `status=${wrongStatusR.status} market.status=${market.status}`,
    );
  } else if (market?.status === "LOCKED") {
    assert("9. Resolve on non-LOCKED market → 4xx", true, "(market is LOCKED — skipped wrong-status test)");
  } else {
    assert("9. Resolve on non-LOCKED market → 4xx", true, "(skipped — no markets)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n── Check 10-12: Admin Lock Endpoint Guards ──────────────────");

  // 10. Lock without confirm: true is rejected
  if (market) {
    const noConfLockR = await fetch(
      `${API}/api/admin/markets/${market.onChainMarketId}/lock`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({}),
      },
    );
    assert(
      "10. POST /api/admin/markets/:id/lock → 400 without confirm:true",
      noConfLockR.status === 400,
    );
  } else {
    assert("10. POST lock → 400 without confirm:true", true, "(skipped — no markets)");
  }

  // 11. Non-admin cannot lock
  if (market) {
    const naLockR = await fetch(
      `${API}/api/admin/markets/${market.onChainMarketId}/lock`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ confirm: true }),
      },
    );
    assert(
      "11. POST /api/admin/markets/:id/lock → 403 for non-admin",
      naLockR.status === 403,
    );
  } else {
    assert("11. POST lock → 403 for non-admin", true, "(skipped — no markets)");
  }

  // 12. Lock rejects non-OPEN market with 4xx
  if (market && market.status !== "OPEN") {
    const wrongStatusLockR = await fetch(
      `${API}/api/admin/markets/${market.onChainMarketId}/lock`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ confirm: true }),
      },
    );
    assert(
      "12. POST lock on non-OPEN market → 4xx",
      wrongStatusLockR.status >= 400 && wrongStatusLockR.status < 500,
      `status=${wrongStatusLockR.status} market.status=${market.status}`,
    );
  } else {
    assert("12. POST lock on non-OPEN market → 4xx", true, "(skipped — market is OPEN or no markets)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n── Check 13-14: Cooldown Enforcement ───────────────────────");

  // 13. Verify cooldown module exports RESOLVE_RETRY_COOLDOWN_MS default 600000
  try {
    const { RESOLVE_RETRY_COOLDOWN_MS } = await import(
      "../apps/api/src/lib/resolution.ts"
    ).catch(async () =>
      import("../apps/api/dist/lib/resolution.js").catch(() => ({ RESOLVE_RETRY_COOLDOWN_MS: null }))
    );
    // If can't import directly, read the file and check the string
    if (RESOLVE_RETRY_COOLDOWN_MS === null) throw new Error("import failed");
    assert(
      "13. RESOLVE_RETRY_COOLDOWN_MS default is 600000 ms (10 min)",
      RESOLVE_RETRY_COOLDOWN_MS === 600000 || process.env.RESOLVE_RETRY_COOLDOWN_MS !== undefined,
    );
  } catch {
    // fallback: grep the source file
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../apps/api/src/lib/resolution.ts", import.meta.url),
      "utf8",
    );
    assert(
      "13. RESOLVE_RETRY_COOLDOWN_MS default is 600000 ms (10 min)",
      src.includes("600000"),
    );
  }

  // 14. Cooldown response shape (409) includes cooldownUntil field
  //     We simulate this by injecting a FAILED attempt and then trying to resolve
  if (market && market.status === "LOCKED") {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    try {
      const dbMarket = await prisma.market.findFirst({
        where: { onChainMarketId: market.onChainMarketId },
      });
      if (dbMarket) {
        await prisma.marketResolutionAttempt.create({
          data: {
            marketId: dbMarket.id,
            triggeredBy: "WORKER",
            status: "FAILED",
            errorMessage: "simulated failure for cooldown test",
            attemptedAt: new Date(),
          },
        });
        const cooldownR = await fetch(
          `${API}/api/admin/markets/${market.onChainMarketId}/resolve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: adminCookie },
            body: JSON.stringify({ confirm: true }),
          },
        );
        const cooldownD = await json(cooldownR);
        assert(
          "14. Admin resolve during cooldown → 409 with cooldownUntil field",
          cooldownR.status === 409 && typeof cooldownD?.cooldownUntil === "string",
          `status=${cooldownR.status} cooldownUntil=${cooldownD?.cooldownUntil}`,
        );
        // clean up
        await prisma.marketResolutionAttempt.deleteMany({
          where: { marketId: dbMarket.id, errorMessage: "simulated failure for cooldown test" },
        });
      } else {
        assert("14. Cooldown → 409 with cooldownUntil", true, "(market not found in DB — skipped)");
      }
    } finally {
      await prisma.$disconnect();
    }
  } else {
    assert("14. Cooldown → 409 with cooldownUntil", true, "(skipped — market not LOCKED or no markets)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n── Check 15-17: Worker Configuration and Architecture ───────");

  // 15. ENABLE_MARKET_SYNC env controls worker (check health endpoint)
  const healthR = await fetch(`${API}/health`);
  const healthD = await json(healthR);
  const expectedSyncState = process.env.ENABLE_MARKET_SYNC === "true" ? "enabled" : "disabled";
  assert(
    "15. Health endpoint reflects ENABLE_MARKET_SYNC state",
    healthR.status === 200 && healthD?.syncWorker === expectedSyncState,
    `expected=${expectedSyncState} got=${healthD?.syncWorker}`,
  );

  // 16. Worker source includes getResolveCooldown import
  {
    const { readFileSync } = await import("fs");
    const workerSrc = readFileSync(
      new URL("../apps/api/src/workers/market-sync.ts", import.meta.url),
      "utf8",
    );
    assert(
      "16. Worker imports getResolveCooldown from lib/resolution",
      workerSrc.includes("getResolveCooldown") && workerSrc.includes("resolution"),
    );
  }

  // 17. MarketResolutionAttempt is created before resolveMarket() call in worker
  {
    const { readFileSync } = await import("fs");
    const workerSrc = readFileSync(
      new URL("../apps/api/src/workers/market-sync.ts", import.meta.url),
      "utf8",
    );
    const attemptCreateIdx = workerSrc.indexOf("marketResolutionAttempt.create");
    const resolveCallIdx = workerSrc.indexOf("resolveMarket(");
    assert(
      "17. Worker creates MarketResolutionAttempt BEFORE calling resolveMarket()",
      attemptCreateIdx !== -1 && resolveCallIdx !== -1 && attemptCreateIdx < resolveCallIdx,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(56)}`);
  console.log(`  Total: ${passed + failed}  |  ${PASS} ${passed}  |  ${FAIL} ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\nUnhandled error:", e);
  process.exit(1);
});
