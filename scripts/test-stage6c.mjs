// Stage 6C admin routes test script
// Run from: apps/api directory
// Usage: node ../../scripts/test-stage6c.mjs

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:4000";
const prisma = new PrismaClient({ log: [] });
let cookieJar = "";

async function api(method, path, body, cookie) {
  const headers = { "Content-Type": "application/json" };
  const jar = cookie ?? cookieJar;
  if (jar) headers["Cookie"] = jar;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && !cookie) cookieJar = setCookie.split(";")[0];
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cookie: setCookie };
}

function pass(msg) { console.log(`  ✓  ${msg}`); }
function fail(msg) { console.log(`  ✗  FAIL: ${msg}`); process.exitCode = 1; }
function section(title) { console.log(`\n── ${title} ${"─".repeat(Math.max(2, 55 - title.length))}`); }

// ── Setup ─────────────────────────────────────────────────────────
section("Setup: create admin user");
const email = `admin-6c-${Date.now()}@karion.test`;
const pw = "Admin6C_Pass!";

cookieJar = "";
const signup = await api("POST", "/auth/signup", { email, password: pw, confirmPassword: pw });
if (signup.status !== 201) { fail(`Signup: ${signup.status}`); process.exit(1); }
const userId = signup.data.user.id;
pass(`Signed up: ${email}`);

await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
pass("Promoted to ADMIN via DB");

cookieJar = "";
const login = await api("POST", "/auth/login", { email, password: pw });
if (login.status !== 200 || login.data.user.role !== "ADMIN") {
  fail(`Admin login failed: ${login.status}`); process.exit(1);
}
pass("Logged in as ADMIN");
const adminCookie = cookieJar;

// Create a regular user for suggestion submission
cookieJar = "";
const userEmail = `user-6c-${Date.now()}@karion.test`;
const su2 = await api("POST", "/auth/signup", { email: userEmail, password: pw, confirmPassword: pw });
const userCookie = su2.cookie.split(";")[0];
pass(`Regular user: ${userEmail}`);

// ── 1: Suggestions list + filter ──────────────────────────────────
section("1. Admin suggestions list");
const sl = await api("GET", "/api/admin/suggestions", null, adminCookie);
if (sl.status === 200 && Array.isArray(sl.data.suggestions))
  pass(`GET /api/admin/suggestions → 200 (${sl.data.suggestions.length} items)`);
else fail(`suggestions list: ${sl.status} ${JSON.stringify(sl.data)}`);

const slf = await api("GET", "/api/admin/suggestions?status=SUBMITTED", null, adminCookie);
if (slf.status === 200) pass("GET /api/admin/suggestions?status=SUBMITTED → 200");
else fail(`filtered suggestions: ${slf.status}`);

// ── 2: Approve suggestion ─────────────────────────────────────────
section("2. Approve suggestion");
const suggBody = {
  question: "Will Stage 6C pass all checks?",
  category: "Technology",
  yesCondition: "All checks pass",
  noCondition: "Any check fails",
  invalidCondition: "Tests not run",
  resolutionUrl: "https://example.com/stage6c",
  resolutionQuery: "Did Stage 6C pass?",
  resolutionDeadline: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
};
const sugg = await api("POST", "/api/suggestions", suggBody, userCookie);
if (sugg.status !== 201) { fail(`Suggestion create: ${sugg.status} ${JSON.stringify(sugg.data)}`); }
const suggId = sugg.data?.suggestion?.id;
pass(`Suggestion created: ${suggId}`);

const appr = await api("POST", `/api/admin/suggestions/${suggId}/approve`, { reviewNotes: "Looks good" }, adminCookie);
if (appr.status === 200 && appr.data.suggestion?.status === "APPROVED")
  pass("POST /:id/approve → APPROVED ✓");
else fail(`Approve: ${appr.status} ${JSON.stringify(appr.data)}`);

// ── 3: Reject suggestion ──────────────────────────────────────────
section("3. Reject suggestion");
// Re-use userCookie from earlier rather than signing up a third user (avoids rate limits)
const sugg2 = await api("POST", "/api/suggestions", {
  ...suggBody, question: "Will this one be rejected?",
}, userCookie);
const suggId2 = sugg2.data?.suggestion?.id;

const rej = await api("POST", `/api/admin/suggestions/${suggId2}/reject`,
  { reviewNotes: "Not relevant to the platform" }, adminCookie);
if (rej.status === 200 && rej.data.suggestion?.status === "REJECTED")
  pass("POST /:id/reject → REJECTED ✓");
else fail(`Reject: ${rej.status} ${JSON.stringify(rej.data)}`);

// Reject requires reviewNotes
const rejNoNote = await api("POST", `/api/admin/suggestions/${suggId}/reject`, { reviewNotes: "" }, adminCookie);
if (rejNoNote.status === 400) pass("Reject without note → 400 ✓");
else fail(`Expected 400 for empty reviewNotes, got: ${rejNoNote.status}`);

// ── 4: confirm:true guard ─────────────────────────────────────────
section("4. confirm:true guards");
const noConfirmCreate = await api("POST", `/api/admin/suggestions/${suggId}/create`, {}, adminCookie);
if (noConfirmCreate.status === 400) pass("Create without confirm → 400 ✓");
else fail(`Expected 400, got: ${noConfirmCreate.status} ${JSON.stringify(noConfirmCreate.data)}`);

const noConfirmLock = await api("POST", "/api/admin/markets/some-market/lock", {}, adminCookie);
if (noConfirmLock.status === 400) pass("Lock without confirm → 400 ✓");
else fail(`Expected 400, got: ${noConfirmLock.status}`);

const noConfirmResolve = await api("POST", "/api/admin/markets/some-market/resolve", {}, adminCookie);
if (noConfirmResolve.status === 400) pass("Resolve without confirm → 400 ✓");
else fail(`Expected 400, got: ${noConfirmResolve.status}`);

// ── 5: Admin markets list ─────────────────────────────────────────
section("5. Admin markets list + sync-status");
const ml = await api("GET", "/api/admin/markets", null, adminCookie);
if (ml.status === 200 && Array.isArray(ml.data.markets))
  pass(`GET /api/admin/markets → 200 (${ml.data.markets.length} markets)`);
else fail(`markets list: ${ml.status} ${JSON.stringify(ml.data)}`);

const mlf = await api("GET", "/api/admin/markets?status=OPEN", null, adminCookie);
if (mlf.status === 200) pass("GET /api/admin/markets?status=OPEN → 200");
else fail(`filtered markets: ${mlf.status}`);

// ── 6: Sync status ────────────────────────────────────────────────
section("6. Sync status");
const ss = await api("GET", "/api/admin/markets/sync-status", null, adminCookie);
if (ss.status === 200) {
  pass("GET /api/admin/markets/sync-status → 200");
  if (typeof ss.data.workerEnabled === "boolean") pass(`workerEnabled: ${ss.data.workerEnabled}`);
  else fail("workerEnabled missing");
  if (typeof ss.data.totalMarkets === "number") pass(`totalMarkets: ${ss.data.totalMarkets}`);
  else fail("totalMarkets missing");
  if (typeof ss.data.staleCount === "number") pass(`staleCount: ${ss.data.staleCount}`);
  else fail("staleCount missing");
  if (Array.isArray(ss.data.staleMarkets)) pass("staleMarkets array present");
  else fail("staleMarkets missing");
  if (ss.data.lastCheckedAt) pass(`lastCheckedAt: ${ss.data.lastCheckedAt}`);
  else fail("lastCheckedAt missing");
} else fail(`sync-status: ${ss.status} ${JSON.stringify(ss.data)}`);

// ── 7: Transaction monitor ────────────────────────────────────────
section("7. Transaction monitor");
const tl = await api("GET", "/api/admin/markets/transactions", null, adminCookie);
if (tl.status === 200 && Array.isArray(tl.data.transactions))
  pass(`GET /transactions → 200 (${tl.data.transactions.length} txs)`);
else fail(`transactions: ${tl.status} ${JSON.stringify(tl.data)}`);

const tlp = await api("GET", "/api/admin/markets/transactions?status=PENDING", null, adminCookie);
if (tlp.status === 200) pass("transactions?status=PENDING → 200");
else fail(`PENDING filter: ${tlp.status}`);

const tlt = await api("GET", "/api/admin/markets/transactions?type=CREATE_MARKET", null, adminCookie);
if (tlt.status === 200) pass("transactions?type=CREATE_MARKET → 200");
else fail(`type filter: ${tlt.status}`);

const tlu = await api("GET", "/api/admin/markets/transactions?userAddress=0x1234", null, adminCookie);
if (tlu.status === 200) pass("transactions?userAddress filter → 200");
else fail(`userAddress filter: ${tlu.status}`);

// ── 8: Audit logs ─────────────────────────────────────────────────
section("8. Admin audit logs written");
const auditApprove = await prisma.adminAuditLog.findFirst({
  where: { action: "APPROVE_SUGGESTION", targetId: suggId },
});
if (auditApprove) pass(`APPROVE_SUGGESTION audit log ✓`);
else fail("APPROVE_SUGGESTION audit log missing");

const auditReject = await prisma.adminAuditLog.findFirst({
  where: { action: "REJECT_SUGGESTION", targetId: suggId2 },
});
if (auditReject) pass(`REJECT_SUGGESTION audit log ✓`);
else fail("REJECT_SUGGESTION audit log missing");

// ── 9: requireAdmin guards ────────────────────────────────────────
section("9. Auth guards");
cookieJar = ""; // clear any leftover cookie before testing anonymous access
const anon = await api("GET", "/api/admin/suggestions");
if (anon.status === 401) pass("Anonymous → 401 ✓");
else fail(`Expected 401 anon, got: ${anon.status}`);

cookieJar = "";
const userLogin = await api("POST", "/auth/login", { email: userEmail, password: pw });
const nonAdminCookie = userLogin.cookie.split(";")[0];
const nonadmin = await api("GET", "/api/admin/suggestions", null, nonAdminCookie);
if (nonadmin.status === 403) pass("Non-admin → 403 ✓");
else fail(`Expected 403 non-admin, got: ${nonadmin.status}`);

// ── 10: .env + contract unchanged ────────────────────────────────
section("10. Env + contract checks");
const staged = execSync("git diff --cached --name-only", {
  cwd: "C:/Users/USER/Desktop/NEW STYLE GENLAYER/KARION", encoding: "utf8",
});
const envStaged = staged.split("\n").some(f => f.includes(".env") && !f.includes(".env.example"));
if (!envStaged) pass(".env not staged ✓");
else fail(".env staged");

const health = await api("GET", "/health");
if (health.data?.contractAddress === "0x90DEDD8bCef8d0872f746cfb56D15E805747BF24")
  pass("Contract address unchanged ✓");
else fail(`Contract changed: ${health.data?.contractAddress}`);

// ── Summary ───────────────────────────────────────────────────────
console.log("\n" + "═".repeat(55));
if (process.exitCode === 1) console.log("  SOME TESTS FAILED — see ✗ lines above");
else console.log("  ALL TESTS PASSED ✓");
console.log("═".repeat(55) + "\n");

await prisma.$disconnect();
