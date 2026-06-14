import type { Response } from "express";
import { prisma } from "./prisma.js";
import { generateSecureToken, hashToken } from "./crypto.js";

const COOKIE_NAME = "karion_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function setSessionCookie(res: Response, rawToken: string): void {
  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // SameSite=None required in production: Vercel (karion.vercel.app) and
    // Fly (karion-api.fly.dev) are different eTLD+1 domains. Lax would block
    // the cookie on cross-site fetch requests. CSRF is handled by the
    // csrfProtection middleware (Origin header check) in production.
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

// encryptedWek: AES-256-GCM(wekHex, SESSION_SIGNING_SECRET) stored as JSON string.
// Pass null when the session is created via a recovery flow that can't derive WEK.
// Signing routes check for null and return 409 wallet-recovery-incomplete.
export async function createSession(
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null,
  encryptedWek?: string | null
): Promise<string> {
  const rawToken = generateSecureToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      encryptedWek: encryptedWek ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  });
  return rawToken;
}

export async function validateSession(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { wallet: true } } },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  prisma.session
    .updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return session;
}

export async function destroySession(rawToken: string): Promise<void> {
  // Deleting the session also clears encryptedWek (it's a column on the same row).
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
}
