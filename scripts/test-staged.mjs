// Stage D attachment API test script
// Usage: node scripts/test-staged.mjs

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

const pw = "StageDTest_Pass!";

// ── Setup: owner user ─────────────────────────────────────────────
section("Setup: create owner user");
const ownerEmail = `owner-d-${Date.now()}@karion.test`;
cookieJar = "";
const ownerSignup = await api("POST", "/auth/signup", { email: ownerEmail, password: pw, confirmPassword: pw });
if (ownerSignup.status !== 201) { fail(`Owner signup: ${ownerSignup.status}`); process.exit(1); }
pass(`Owner signed up: ${ownerEmail}`);
const ownerCookie = cookieJar;

// ── Setup: second user ────────────────────────────────────────────
section("Setup: create second user");
const otherEmail = `other-d-${Date.now()}@karion.test`;
cookieJar = "";
const otherSignup = await api("POST", "/auth/signup", { email: otherEmail, password: pw, confirmPassword: pw });
if (otherSignup.status !== 201) { fail(`Other signup: ${otherSignup.status}`); process.exit(1); }
pass(`Other user signed up: ${otherEmail}`);
const otherCookie = cookieJar;
const otherId = otherSignup.data.user.id;

// ── Setup: admin user ─────────────────────────────────────────────
section("Setup: create admin user");
const adminEmail = `admin-d-${Date.now()}@karion.test`;
cookieJar = "";
const adminSignup = await api("POST", "/auth/signup", { email: adminEmail, password: pw, confirmPassword: pw });
if (adminSignup.status !== 201) { fail(`Admin signup: ${adminSignup.status}`); process.exit(1); }
const adminId = adminSignup.data.user.id;
await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
cookieJar = "";
const adminLogin = await api("POST", "/auth/login", { email: adminEmail, password: pw });
if (adminLogin.status !== 200) { fail(`Admin login: ${adminLogin.status}`); process.exit(1); }
pass(`Admin ready: ${adminEmail}`);
const adminCookie = cookieJar;

// ── Setup: create a suggestion as owner ───────────────────────────
section("Setup: submit suggestion");
const suggBody = {
  question: "Will Stage D attachment tests pass all checks?",
  category: "Technology",
  yesCondition: "All checks pass without failure",
  noCondition: "Any check fails or is skipped",
  invalidCondition: "Tests are never run",
  resolutionUrl: "https://example.com/staged",
  resolutionQuery: "Did Stage D tests pass?",
  resolutionDeadline: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
};
const sugg = await api("POST", "/api/suggestions", suggBody, ownerCookie);
if (sugg.status !== 201) { fail(`Suggestion create: ${sugg.status} ${JSON.stringify(sugg.data)}`); process.exit(1); }
const suggId = sugg.data?.suggestion?.id;
pass(`Suggestion created: ${suggId}`);

// ── 1: Submit without attachments ─────────────────────────────────
section("1. Suggestion exists, no attachments yet");
const emptyList = await api("GET", `/api/suggestions/${suggId}/attachments`, null, ownerCookie);
if (emptyList.status === 200 && Array.isArray(emptyList.data.attachments) && emptyList.data.attachments.length === 0)
  pass("GET /attachments → 200 empty array");
else fail(`Expected empty list, got: ${emptyList.status} ${JSON.stringify(emptyList.data)}`);

// ── 2: Save image attachment ──────────────────────────────────────
section("2. Save image attachment (owner)");
const imgPayload = {
  fileUrl: "https://utfs.io/f/fake-image-key",
  fileKey: "fake-image-key",
  fileType: "image/png",
  fileSize: 102400,
};
const imgSave = await api("POST", `/api/suggestions/${suggId}/attachments`, imgPayload, ownerCookie);
if (imgSave.status === 201 && imgSave.data?.attachment?.id)
  pass(`Image attachment saved: ${imgSave.data.attachment.id}`);
else fail(`Image save: ${imgSave.status} ${JSON.stringify(imgSave.data)}`);
const imgId = imgSave.data?.attachment?.id;

// Verify relatedType / relatedId in DB
if (imgId) {
  const dbRecord = await prisma.uploadedFile.findUnique({ where: { id: imgId } });
  if (dbRecord?.relatedType === "SUGGESTION" && dbRecord?.relatedId === suggId)
    pass("DB: relatedType=SUGGESTION, relatedId=suggId ✓");
  else fail(`DB mismatch: relatedType=${dbRecord?.relatedType}, relatedId=${dbRecord?.relatedId}`);
}

// ── 3: Save PDF attachment ────────────────────────────────────────
section("3. Save PDF attachment (owner)");
const pdfPayload = {
  fileUrl: "https://utfs.io/f/fake-pdf-key",
  fileKey: "fake-pdf-key",
  fileType: "application/pdf",
  fileSize: 204800,
};
const pdfSave = await api("POST", `/api/suggestions/${suggId}/attachments`, pdfPayload, ownerCookie);
if (pdfSave.status === 201 && pdfSave.data?.attachment?.id)
  pass("PDF attachment saved ✓");
else fail(`PDF save: ${pdfSave.status} ${JSON.stringify(pdfSave.data)}`);

// ── 4: List attachments — owner sees both ─────────────────────────
section("4. List attachments as owner");
const listOwner = await api("GET", `/api/suggestions/${suggId}/attachments`, null, ownerCookie);
if (listOwner.status === 200 && listOwner.data?.attachments?.length === 2)
  pass("Owner sees 2 attachments ✓");
else fail(`List (owner): ${listOwner.status} count=${listOwner.data?.attachments?.length}`);

// ── 5: List attachments — admin sees both ─────────────────────────
section("5. List attachments as admin");
const listAdmin = await api("GET", `/api/suggestions/${suggId}/attachments`, null, adminCookie);
if (listAdmin.status === 200 && listAdmin.data?.attachments?.length === 2)
  pass("Admin sees 2 attachments ✓");
else fail(`List (admin): ${listAdmin.status} count=${listAdmin.data?.attachments?.length}`);

// ── 6: Admin can save attachment ──────────────────────────────────
section("6. Admin saves attachment to owner's suggestion");
const adminAttachment = await api(
  "POST",
  `/api/suggestions/${suggId}/attachments`,
  { fileUrl: "https://utfs.io/f/admin-key", fileKey: "admin-key", fileType: "image/jpeg", fileSize: 51200 },
  adminCookie,
);
if (adminAttachment.status === 201)
  pass("Admin can attach files to any suggestion ✓");
else fail(`Admin attach: ${adminAttachment.status} ${JSON.stringify(adminAttachment.data)}`);

// ── 7: Non-owner cannot list attachments ─────────────────────────
section("7. Non-owner cannot view attachments");
const listOther = await api("GET", `/api/suggestions/${suggId}/attachments`, null, otherCookie);
if (listOther.status === 403)
  pass("Non-owner GET /attachments → 403 ✓");
else fail(`Expected 403, got: ${listOther.status}`);

// ── 8: Non-owner cannot save attachments ─────────────────────────
section("8. Non-owner cannot save attachments");
const saveOther = await api(
  "POST",
  `/api/suggestions/${suggId}/attachments`,
  { fileUrl: "https://utfs.io/f/x", fileKey: "x", fileType: "image/png", fileSize: 100 },
  otherCookie,
);
if (saveOther.status === 403)
  pass("Non-owner POST /attachments → 403 ✓");
else fail(`Expected 403, got: ${saveOther.status}`);

// ── 9: Unauthenticated cannot access ─────────────────────────────
section("9. Unauthenticated access rejected");
const anonList = await api("GET", `/api/suggestions/${suggId}/attachments`, null, "");
if (anonList.status === 401)
  pass("Anon GET /attachments → 401 ✓");
else fail(`Expected 401, got: ${anonList.status}`);

const anonSave = await api(
  "POST",
  `/api/suggestions/${suggId}/attachments`,
  { fileUrl: "https://utfs.io/f/y", fileKey: "y", fileType: "image/png", fileSize: 100 },
  "",
);
if (anonSave.status === 401)
  pass("Anon POST /attachments → 401 ✓");
else fail(`Expected 401, got: ${anonSave.status}`);

// ── 10: File type validation ──────────────────────────────────────
section("10. File type validation");
const badType = await api(
  "POST",
  `/api/suggestions/${suggId}/attachments`,
  { fileUrl: "https://utfs.io/f/z", fileKey: "z", fileType: "text/html", fileSize: 1024 },
  ownerCookie,
);
if (badType.status === 400)
  pass("text/html rejected → 400 ✓");
else fail(`Expected 400 for bad type, got: ${badType.status}`);

const exeType = await api(
  "POST",
  `/api/suggestions/${suggId}/attachments`,
  { fileUrl: "https://utfs.io/f/exe", fileKey: "exe", fileType: "application/x-msdownload", fileSize: 1024 },
  ownerCookie,
);
if (exeType.status === 400)
  pass("application/x-msdownload rejected → 400 ✓");
else fail(`Expected 400 for executable, got: ${exeType.status}`);

// ── 11: Missing / malformed metadata ─────────────────────────────
section("11. Malformed attachment metadata");
const missingUrl = await api(
  "POST",
  `/api/suggestions/${suggId}/attachments`,
  { fileKey: "k", fileType: "image/png", fileSize: 100 },
  ownerCookie,
);
if (missingUrl.status === 400)
  pass("Missing fileUrl → 400 ✓");
else fail(`Expected 400 for missing fileUrl, got: ${missingUrl.status}`);

const badSize = await api(
  "POST",
  `/api/suggestions/${suggId}/attachments`,
  { fileUrl: "https://utfs.io/f/big", fileKey: "big", fileType: "image/png", fileSize: 10 * 1024 * 1024 },
  ownerCookie,
);
if (badSize.status === 400)
  pass("Oversized file (10MB) → 400 ✓");
else fail(`Expected 400 for oversized file, got: ${badSize.status}`);

// ── 12: Non-existent suggestion ───────────────────────────────────
section("12. Non-existent suggestion returns 404");
const notFound = await api("GET", "/api/suggestions/does-not-exist/attachments", null, ownerCookie);
if (notFound.status === 404)
  pass("Non-existent suggestion → 404 ✓");
else fail(`Expected 404, got: ${notFound.status}`);

// ── 13: Env + contract unchanged ─────────────────────────────────
section("13. Env + contract checks");
const staged = execSync("git diff --cached --name-only", {
  cwd: "C:/Users/USER/Desktop/NEW STYLE GENLAYER/KARION", encoding: "utf8",
});
const envStaged = staged.split("\n").some((f) => f.includes(".env") && !f.includes(".env.example"));
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
