import { verify } from "@node-rs/argon2";
import { prisma } from "../lib/prisma.js";
import { decryptPrivateKey } from "../lib/wallet.js";

const ARGON2_OPTS = { memoryCost: 65536, timeCost: 3, parallelism: 4 };

export async function exportPrivateKey(
  userId: string,
  password: string,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("USER_NOT_FOUND");

  // Re-authenticate before exporting
  const passwordValid = await verify(user.passwordHash, password, ARGON2_OPTS);
  if (!passwordValid) throw new Error("INVALID_CREDENTIALS");

  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    include: { keyWraps: { where: { method: "PASSWORD" } } },
  });

  if (!wallet || wallet.keyWraps.length === 0) throw new Error("WALLET_NOT_FOUND");

  const wrap = wallet.keyWraps[0];
  let privateKey: string;
  try {
    privateKey = await decryptPrivateKey(
      wallet.encryptedPrivateKey,
      { encryptedWalletKey: wrap.encryptedWalletKey, salt: wrap.salt },
      password
    );
  } catch {
    throw new Error("DECRYPT_FAILED");
  }

  await prisma.recoveryAuditLog.create({
    data: {
      userId,
      walletId: wallet.id,
      action: "KEY_EXPORTED",
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  });

  return privateKey;
}
