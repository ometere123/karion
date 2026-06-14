import { hash, verify } from "@node-rs/argon2";
import { prisma } from "../lib/prisma.js";
import {
  createEmbeddedWallet,
  createSystemWrap,
  rewrapWekWithNewPassword,
  rewrapWekWithPasswordFromSystem,
  deriveWekFromPasswordWrap,
} from "../lib/wallet.js";
import { generateSecureToken, hashToken } from "../lib/crypto.js";
import { sendPasswordResetEmail } from "../lib/email.js";
import { encryptWekForSession } from "../lib/wallet-signer.js";

const ARGON2_OPTS = { memoryCost: 65536, timeCost: 3, parallelism: 4 };

export async function signupUser(
  email: string,
  password: string,
  ipAddress?: string | null
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("EMAIL_EXISTS");

  const passwordHash = await hash(password, ARGON2_OPTS);

  const user = await prisma.user.create({
    data: { email, passwordHash },
  });

  const walletData = await createEmbeddedWallet(password);

  // Create system wrap — lets password reset auto-recover the wallet without
  // requiring the user's recovery key. SECURITY: wekHex is never logged.
  const systemWrap = await createSystemWrap(walletData.wekHex);

  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      address: walletData.address,
      encryptedPrivateKey: walletData.encryptedPrivateKey,
      keyWraps: {
        create: [
          {
            method: "PASSWORD",
            encryptedWalletKey: walletData.wekPasswordWrapped.encryptedWalletKey,
            salt: walletData.wekPasswordWrapped.salt,
            kdfParams: walletData.wekPasswordWrapped.kdfParams,
          },
          {
            method: "RECOVERY",
            encryptedWalletKey: walletData.wekRecoveryWrapped.encryptedWalletKey,
            salt: walletData.wekRecoveryWrapped.salt,
            kdfParams: walletData.wekRecoveryWrapped.kdfParams,
          },
          {
            method: "SYSTEM",
            encryptedWalletKey: systemWrap.encryptedWalletKey,
            salt: systemWrap.salt,
            kdfParams: systemWrap.kdfParams,
          },
        ],
      },
    },
  });

  await prisma.recoveryAuditLog.create({
    data: {
      userId: user.id,
      walletId: wallet.id,
      action: "WALLET_CREATED",
      ipAddress: ipAddress ?? null,
    },
  });

  // Encrypt the WEK for session storage so the signup flow can sign txs
  // immediately without forcing a re-login. SECURITY: wekHex is never logged.
  const encryptedWek = encryptWekForSession(walletData.wekHex);

  return {
    userId: user.id,
    email: user.email,
    walletAddress: walletData.address,
    recoveryKey: walletData.recoveryKey,
    encryptedWek,
  };
}

export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { wallet: { include: { keyWraps: { where: { method: "PASSWORD" } } } } },
  });

  const dummyHash = "$argon2id$v=19$m=65536,t=3,p=4$dGVzdA$dGVzdA";
  const passwordValid = user
    ? await verify(user.passwordHash, password, ARGON2_OPTS)
    : (await verify(dummyHash, password, ARGON2_OPTS).catch(() => false), false);

  if (!user || !passwordValid) throw new Error("INVALID_CREDENTIALS");

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    walletAddress: user.wallet?.address ?? null,
    walletId: user.wallet?.id ?? null,
    // Password wrap for WEK derivation — used by buildEncryptedWekForSession.
    passwordWrap:
      user.wallet?.keyWraps[0]
        ? {
            encryptedWalletKey: user.wallet.keyWraps[0].encryptedWalletKey,
            salt: user.wallet.keyWraps[0].salt,
          }
        : null,
    password, // passed through so the route can call buildEncryptedWekForSession
  };
}

// Derives the WEK from the password wrap and encrypts it for session storage.
// Also backfills the SYSTEM wrap if this wallet does not have one yet
// (covers users created before Stage 6A). Backfill is non-blocking — it does
// not affect login latency and failures are logged but do not prevent login.
// SECURITY: neither the wekHex nor the password is stored after this call.
export async function buildEncryptedWekForSession(
  walletId: string | null,
  passwordWrap: { encryptedWalletKey: string; salt: string } | null,
  password: string
): Promise<string | null> {
  if (!passwordWrap || !walletId) return null;
  try {
    const wekHex = await deriveWekFromPasswordWrap(passwordWrap, password);
    // Non-blocking SYSTEM wrap backfill for pre-6A accounts
    _backfillSystemWrapIfMissing(walletId, wekHex).catch((err) => {
      console.error("[system-wrap-backfill]", err instanceof Error ? err.message : err);
    });
    return encryptWekForSession(wekHex);
  } catch {
    return null; // PBKDF2 or AES-GCM failure — proceed without WEK
  }
}

async function _backfillSystemWrapIfMissing(walletId: string, wekHex: string): Promise<void> {
  const existing = await prisma.walletKeyWrap.findUnique({
    where: { walletId_method: { walletId, method: "SYSTEM" } },
  });
  if (existing) return;

  let wrap: { encryptedWalletKey: string; salt: string; kdfParams: string };
  try {
    wrap = await createSystemWrap(wekHex);
  } catch {
    // SYSTEM_RECOVERY_SECRET not available — skip silently
    return;
  }

  await prisma.walletKeyWrap.create({
    data: { walletId, method: "SYSTEM", ...wrap },
  });
}

export async function initiatePasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const rawToken = generateSecureToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const resetLink = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password?token=${rawToken}`;
  await sendPasswordResetEmail(user.email, resetLink);
}

// Resets the user's password and, if a SYSTEM wrap is present, automatically
// re-wraps the WEK with the new password so the wallet address is preserved.
//
// Returns:
//   walletAutoRecovered: true  — WEK re-wrapped, encryptedWek ready for a new
//                                session. userId and walletAddress are set.
//                                Wallet address is UNCHANGED.
//   walletAutoRecovered: false — No SYSTEM wrap (old account not yet backfilled).
//                                Password updated. User must use recovery key.
//
// SECURITY:
//   - wekHex and derived keys are local variables — never logged.
//   - All DB writes (password, PASSWORD wrap, session purge, audit log) are in
//     one atomic transaction. Partial updates cannot occur.
//   - SYSTEM wrap and RECOVERY wrap rows are never modified here.
export async function resetPasswordWithSystemWrap(
  rawToken: string,
  newPassword: string,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<{
  walletAutoRecovered: boolean;
  encryptedWek: string | null;
  userId: string;
  email: string;
  role: string;
  walletAddress: string | null;
}> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("INVALID_OR_EXPIRED_TOKEN");
  }

  const newPasswordHash = await hash(newPassword, ARGON2_OPTS);

  // Fetch user, wallet, and SYSTEM wrap in one query
  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    include: {
      wallet: { include: { keyWraps: { where: { method: "SYSTEM" } } } },
    },
  });
  if (!user) throw new Error("INVALID_OR_EXPIRED_TOKEN");

  const wallet = user.wallet;

  if (wallet && wallet.keyWraps.length > 0) {
    // ── System-wrap path: auto re-wrap WEK, user gets seamless recovery ───────
    const systemWrap = wallet.keyWraps[0];
    let result: { wekHex: string; newPasswordWrap: { encryptedWalletKey: string; salt: string; kdfParams: string } };

    try {
      result = await rewrapWekWithPasswordFromSystem(
        { encryptedWalletKey: systemWrap.encryptedWalletKey, salt: systemWrap.salt },
        newPassword,
      );
    } catch (err) {
      // System wrap decryption failed (e.g., secret rotated without re-wrap migration).
      // Fall back to password-only reset, guide user to recovery key flow.
      console.error("[reset-password-system-wrap-decrypt]", err instanceof Error ? err.message : err);
      await _fallbackPasswordOnlyReset(record.id, record.userId, newPasswordHash);
      return {
        walletAutoRecovered: false,
        encryptedWek: null,
        userId: user.id,
        email: user.email,
        role: user.role,
        walletAddress: wallet?.address ?? null,
      };
    }

    await prisma.$transaction([
      // Update password hash
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash: newPasswordHash } }),
      // Replace PASSWORD wrap — old wrap used old password, now stale
      prisma.walletKeyWrap.deleteMany({ where: { walletId: wallet.id, method: "PASSWORD" } }),
      prisma.walletKeyWrap.create({
        data: {
          walletId: wallet.id,
          method: "PASSWORD",
          encryptedWalletKey: result.newPasswordWrap.encryptedWalletKey,
          salt: result.newPasswordWrap.salt,
          kdfParams: result.newPasswordWrap.kdfParams,
        },
      }),
      // Mark token used
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Purge all sessions — old encryptedWek values derived from old password are now stale
      prisma.session.deleteMany({ where: { userId: record.userId } }),
      // Audit log — every use of the SYSTEM wrap is recorded
      prisma.recoveryAuditLog.create({
        data: {
          userId: record.userId,
          walletId: wallet.id,
          action: "SYSTEM_WRAP_USED",
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      }),
    ]);

    // Encrypt the freshly-derived WEK for the new session.
    // SECURITY: wekHex is used here then falls out of scope — never logged.
    const encryptedWek = encryptWekForSession(result.wekHex);
    return {
      walletAutoRecovered: true,
      encryptedWek,
      userId: user.id,
      email: user.email,
      role: user.role,
      walletAddress: wallet.address,
    };
  }

  // ── Fallback path: no SYSTEM wrap (pre-6A account not yet backfilled) ────────
  // Password is updated; user must use /auth/recover-wallet with recovery key.
  await _fallbackPasswordOnlyReset(record.id, record.userId, newPasswordHash);
  return {
    walletAutoRecovered: false,
    encryptedWek: null,
    userId: user.id,
    email: user.email,
    role: user.role,
    walletAddress: wallet?.address ?? null,
  };
}

async function _fallbackPasswordOnlyReset(
  tokenId: string,
  userId: string,
  newPasswordHash: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: newPasswordHash } }),
    prisma.passwordResetToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

export async function recoverWalletAfterReset(
  userId: string,
  recoveryKey: string,
  newPassword: string,
  ipAddress?: string | null
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("USER_NOT_FOUND");

  const passwordValid = await verify(user.passwordHash, newPassword, ARGON2_OPTS);
  if (!passwordValid) throw new Error("INVALID_CREDENTIALS");

  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    include: { keyWraps: { where: { method: "RECOVERY" } } },
  });

  if (!wallet || wallet.keyWraps.length === 0) throw new Error("WALLET_NOT_FOUND");

  const recoveryWrap = wallet.keyWraps[0];

  let newPasswordWrap: { encryptedWalletKey: string; salt: string; kdfParams: string };
  try {
    newPasswordWrap = await rewrapWekWithNewPassword(
      { encryptedWalletKey: recoveryWrap.encryptedWalletKey, salt: recoveryWrap.salt },
      recoveryKey,
      newPassword
    );
  } catch {
    throw new Error("INVALID_RECOVERY_KEY");
  }

  await prisma.$transaction([
    prisma.walletKeyWrap.deleteMany({
      where: { walletId: wallet.id, method: "PASSWORD" },
    }),
    prisma.walletKeyWrap.create({
      data: {
        walletId: wallet.id,
        method: "PASSWORD",
        encryptedWalletKey: newPasswordWrap.encryptedWalletKey,
        salt: newPasswordWrap.salt,
        kdfParams: newPasswordWrap.kdfParams,
      },
    }),
    prisma.recoveryAuditLog.create({
      data: {
        userId,
        walletId: wallet.id,
        action: "PASSWORD_REWRAP",
        ipAddress: ipAddress ?? null,
      },
    }),
  ]);
}
