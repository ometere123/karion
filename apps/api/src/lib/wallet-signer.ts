// wallet-signer.ts
// Wallet decryption and GenLayer account creation for transaction signing.
//
// SECURITY INVARIANTS — enforced in code and by review:
//   1. Never log wekHex, privateKey, encryptedWek, or SESSION_SIGNING_SECRET.
//   2. wekHex and privateKey are local variables; they are never assigned to
//      module-level or request-level state.
//   3. The genlayer-js account object returned by createUserAccountFromSession
//      holds the private key internally. Callers must not persist it beyond
//      the lifetime of a single request handler.
//   4. SESSION_SIGNING_SECRET is accessed only through getSessionSigningKey()
//      and never interpolated into strings or logged.

import { createAccount } from "genlayer-js";
import { prisma } from "./prisma.js";
import { encryptAES, decryptAES, type EncryptedData } from "./crypto.js";

// Lazy — validated at first call so module import never throws during startup.
// Startup validation in index.ts catches missing/invalid values before any
// request is handled.
function getSessionSigningKey(): Buffer {
  const hex = process.env.SESSION_SIGNING_SECRET;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "SESSION_SIGNING_SECRET must be set to exactly 64 hex characters (32 bytes)"
    );
  }
  return Buffer.from(hex, "hex");
}

// Encrypts the WEK (64-hex-char string) for storage in the Session row.
// Result is a JSON string of EncryptedData — safe to store as a database string.
// SECURITY: never log wekHex.
export function encryptWekForSession(wekHex: string): string {
  const key = getSessionSigningKey();
  const encrypted = encryptAES(wekHex, key);
  return JSON.stringify(encrypted);
}

// Decrypts the stored encryptedWek back to the raw WEK hex.
// SECURITY: never log the return value.
function decryptWekFromSession(encryptedWekJson: string): string {
  const key = getSessionSigningKey();
  return decryptAES(JSON.parse(encryptedWekJson) as EncryptedData, key);
}

export interface UserAccount {
  account: ReturnType<typeof createAccount>;
  walletAddress: string;
}

// Decrypts the user's embedded wallet and returns a genlayer-js account.
// The private key lives only in the returned account object and in local
// variables within this function — it is never stored anywhere.
//
// Throws:
//   WALLET_NOT_FOUND      — user has no wallet record
//   DECRYPT_FAILED        — AES-GCM tag mismatch (bad key or corrupted data)
export async function createUserAccountFromSession(
  userId: string,
  encryptedWek: string
): Promise<UserAccount> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new Error("WALLET_NOT_FOUND");

  // Decrypt WEK from session — local scope only, never logged
  const wekHex = decryptWekFromSession(encryptedWek);

  // Decrypt private key with WEK — local scope only, never logged
  let privateKey: string;
  try {
    const wek = Buffer.from(wekHex, "hex");
    privateKey = decryptAES(
      JSON.parse(wallet.encryptedPrivateKey) as EncryptedData,
      wek
    );
  } catch {
    throw new Error("DECRYPT_FAILED");
  }

  // Create account — privateKey is passed in and held by the account object
  const account = createAccount(privateKey as `0x${string}`);

  return { account, walletAddress: wallet.address };
}
