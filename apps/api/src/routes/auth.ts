import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import {
  signupLimiter,
  loginLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  walletRecoveryLimiter,
} from "../middleware/rateLimit.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  signupUser,
  loginUser,
  buildEncryptedWekForSession,
  initiatePasswordReset,
  resetPasswordWithSystemWrap,
  recoverWalletAfterReset,
} from "../services/auth.service.js";
import {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  destroySession,
} from "../lib/session.js";
import { encryptWekForSession } from "../lib/wallet-signer.js";
import { deriveWekFromPasswordWrap } from "../lib/wallet.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().length(64, "Invalid reset token"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
});

const recoverWalletSchema = z.object({
  recoveryKey: z.string().length(64, "Recovery key must be 64 hex characters"),
  newPassword: z.string().min(8).max(128),
});

// POST /auth/signup
router.post(
  "/signup",
  signupLimiter,
  validate(signupSchema),
  async (req, res) => {
    try {
      const { email, password } = req.body as z.infer<typeof signupSchema>;
      const result = await signupUser(email, password, req.ip);
      // encryptedWek was derived during wallet creation — store in session
      const rawToken = await createSession(
        result.userId,
        req.ip,
        req.headers["user-agent"],
        result.encryptedWek
      );
      setSessionCookie(res, rawToken);
      res.status(201).json({
        message: "Account created",
        user: {
          id: result.userId,
          email: result.email,
          walletAddress: result.walletAddress,
        },
        recoveryKey: result.recoveryKey,
        recoveryKeyWarning:
          "Save this recovery key now. It will not be shown again. You need it to restore wallet access if you forget your password.",
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "EMAIL_EXISTS") {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }
      console.error("[signup]", err);
      res.status(500).json({ error: "Failed to create account" });
    }
  }
);

// POST /auth/login
router.post(
  "/login",
  loginLimiter,
  validate(loginSchema),
  async (req, res) => {
    try {
      const { email, password } = req.body as z.infer<typeof loginSchema>;
      const user = await loginUser(email, password);

      // Derive and encrypt WEK for session. Also backfills the SYSTEM wrap
      // for pre-6A accounts (non-blocking, does not affect login latency).
      // SECURITY: password and wekHex are used here and then discarded.
      const encryptedWek = await buildEncryptedWekForSession(
        user.walletId,
        user.passwordWrap,
        user.password
      );

      const rawToken = await createSession(
        user.userId,
        req.ip,
        req.headers["user-agent"],
        encryptedWek
      );
      setSessionCookie(res, rawToken);
      res.json({
        message: "Logged in",
        user: {
          id: user.userId,
          email: user.email,
          role: user.role,
          walletAddress: user.walletAddress,
        },
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "INVALID_CREDENTIALS") {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      console.error("[login]", err);
      res.status(500).json({ error: "Login failed" });
    }
  }
);

// POST /auth/logout
router.post("/logout", requireAuth, async (req: AuthRequest, res) => {
  try {
    // destroySession deletes the session row, which also deletes encryptedWek.
    if (req.sessionToken) await destroySession(req.sessionToken);
  } catch {
    // best-effort; always clear the cookie
  }
  clearSessionCookie(res);
  res.json({ message: "Logged out" });
});

// GET /auth/me
router.get("/me", requireAuth, (req: AuthRequest, res) => {
  res.json({
    user: {
      ...req.user,
      createdAt: req.user!.createdAt.toISOString(),
    },
    walletAddress: req.walletAddress,
  });
});

// GET /auth/system-recovery-status
// Returns whether the authenticated user's wallet has a SYSTEM wrap (6A+).
// Safe to expose: no secrets returned, just a boolean + wallet address + email.
router.get("/system-recovery-status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const systemWrap = await prisma.walletKeyWrap.findFirst({
      where: { wallet: { userId: req.user!.id }, method: "SYSTEM" },
      select: { id: true },
    });
    res.json({
      hasSystemRecovery: !!systemWrap,
      walletAddress: req.walletAddress,
      email: req.user!.email,
    });
  } catch (err) {
    console.error("[system-recovery-status]", err);
    res.status(500).json({ error: "Failed to fetch recovery status" });
  }
});

// POST /auth/forgot-password
router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  validate(forgotPasswordSchema),
  async (req, res) => {
    const { email } = req.body as z.infer<typeof forgotPasswordSchema>;
    await initiatePasswordReset(email).catch((err) => {
      console.error("[forgot-password]", err);
    });
    res.json({
      message: "If that email is registered, a reset link has been sent",
    });
  }
);

// POST /auth/reset-password
// If the wallet has a SYSTEM wrap:
//   - Re-wraps WEK with new password automatically (wallet address preserved)
//   - Creates a new session immediately (walletAutoRecovered: true)
//   - User is logged in with the same wallet address — no extra steps needed
// If no SYSTEM wrap (pre-6A account not yet backfilled on login):
//   - Updates password only; user must call /auth/recover-wallet with recovery key
//   - Returns walletAutoRecovered: false
router.post(
  "/reset-password",
  resetPasswordLimiter,
  validate(resetPasswordSchema),
  async (req, res) => {
    try {
      const { token, newPassword } = req.body as z.infer<typeof resetPasswordSchema>;
      const result = await resetPasswordWithSystemWrap(
        token,
        newPassword,
        req.ip,
        req.headers["user-agent"] as string | undefined,
      );

      if (result.walletAutoRecovered && result.encryptedWek) {
        // SYSTEM wrap decrypted WEK successfully — create session immediately.
        // The wallet address is identical to before the reset.
        const rawToken = await createSession(
          result.userId,
          req.ip,
          req.headers["user-agent"],
          result.encryptedWek,
        );
        setSessionCookie(res, rawToken);
        res.json({
          message: "Password reset successfully. Your wallet address is unchanged.",
          walletAutoRecovered: true,
          user: {
            id: result.userId,
            email: result.email,
            role: result.role,
            walletAddress: result.walletAddress,
          },
        });
      } else {
        clearSessionCookie(res);
        res.json({
          message:
            "Password reset successfully. Log in with your new password, then restore wallet access using your recovery key.",
          walletAutoRecovered: false,
        });
      }
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message === "INVALID_OR_EXPIRED_TOKEN"
      ) {
        res.status(400).json({ error: "Invalid or expired reset token" });
        return;
      }
      console.error("[reset-password]", err);
      res.status(500).json({ error: "Password reset failed" });
    }
  }
);

// POST /auth/recover-wallet
// Fallback for accounts that did not have a SYSTEM wrap at reset time.
// After password reset + re-login, re-wraps the WEK with the new password.
// Creates a new session with the freshly-derived encryptedWek.
router.post(
  "/recover-wallet",
  walletRecoveryLimiter,
  requireAuth,
  validate(recoverWalletSchema),
  async (req: AuthRequest, res) => {
    try {
      const { recoveryKey, newPassword } = req.body as z.infer<
        typeof recoverWalletSchema
      >;
      await recoverWalletAfterReset(
        req.user!.id,
        recoveryKey,
        newPassword,
        req.ip
      );

      // Rotate the session: the old encryptedWek (if any) is now stale.
      if (req.sessionToken) await destroySession(req.sessionToken);

      const wallet = await prisma.wallet.findUnique({
        where: { userId: req.user!.id },
        include: { keyWraps: { where: { method: "PASSWORD" } } },
      });
      const wrap = wallet?.keyWraps[0] ?? null;
      let encryptedWek: string | null = null;
      if (wrap) {
        try {
          const wekHex = await deriveWekFromPasswordWrap(
            { encryptedWalletKey: wrap.encryptedWalletKey, salt: wrap.salt },
            newPassword,
          );
          encryptedWek = encryptWekForSession(wekHex);
        } catch {
          // Derivation failure — session will have null encryptedWek; signing
          // routes will prompt re-login rather than throwing.
        }
      }

      const rawToken = await createSession(
        req.user!.id,
        req.ip,
        req.headers["user-agent"],
        encryptedWek
      );
      setSessionCookie(res, rawToken);

      res.json({
        message: "Wallet access restored. Your wallet address is unchanged.",
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === "INVALID_RECOVERY_KEY") {
          res.status(400).json({ error: "Invalid recovery key" });
          return;
        }
        if (err.message === "INVALID_CREDENTIALS") {
          res.status(401).json({ error: "Password does not match" });
          return;
        }
      }
      console.error("[recover-wallet]", err);
      res.status(500).json({ error: "Wallet recovery failed" });
    }
  }
);

export default router;
