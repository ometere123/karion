import type { Request, Response, NextFunction } from "express";
import { validateSession } from "../lib/session.js";

const COOKIE_NAME = "karion_session";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    emailVerified: boolean;
    createdAt: Date;
  };
  sessionToken?: string;
  walletAddress?: string | null;
  // sessionEncryptedWek: the AES-256-GCM encrypted WEK from the session row.
  // null when the session was created after a password-reset recovery flow.
  // SECURITY: never log this value.
  sessionEncryptedWek?: string | null;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawToken = req.cookies?.[COOKIE_NAME];
  if (!rawToken) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const session = await validateSession(rawToken);
  if (!session) {
    res.status(401).json({ error: "Session expired or invalid" });
    return;
  }

  req.user = {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    emailVerified: session.user.emailVerified,
    createdAt: session.user.createdAt,
  };
  req.sessionToken = rawToken;
  req.walletAddress = session.user.wallet?.address ?? null;
  req.sessionEncryptedWek = session.encryptedWek ?? null;

  next();
}

export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  await requireAuth(req, res, () => {
    if ((req as AuthRequest).user?.role !== "ADMIN") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}

// Guards value-moving routes that require a usable embedded wallet.
// Must be composed after requireAuth.
export function requireWalletReady(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.sessionEncryptedWek) {
    res.status(409).json({
      error: "Wallet recovery incomplete",
      hint: "Log out, log back in, and complete wallet recovery with your recovery key before signing transactions.",
    });
    return;
  }
  next();
}
