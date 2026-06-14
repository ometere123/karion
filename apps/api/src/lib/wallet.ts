import { ethers } from "ethers";
import {
  generateSecureToken,
  encryptAES,
  decryptAES,
  deriveKey,
  deriveHkdfKey,
  generateSalt,
  KDF_PARAMS,
  type EncryptedData,
} from "./crypto.js";

const KDF_PARAMS_JSON = JSON.stringify(KDF_PARAMS);

// HKDF info string — baked into every SYSTEM wrap ciphertext via the derived key.
// Changing this value would invalidate all existing SYSTEM wraps.
const SYSTEM_WRAP_INFO = "karion-system-wrap-v1";
const SYSTEM_WRAP_KDF_PARAMS = JSON.stringify({
  method: "hkdf",
  hash: "sha256",
  info: SYSTEM_WRAP_INFO,
  length: 32,
});

// Returns SYSTEM_RECOVERY_SECRET as a Buffer. Validates format but does NOT
// log the value. Called lazily so module import never throws at startup —
// startup validation in index.ts catches missing values before any request.
// SECURITY: never log the return value.
function getSystemRecoverySecret(): Buffer {
  const hex = process.env.SYSTEM_RECOVERY_SECRET;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "SYSTEM_RECOVERY_SECRET must be set to exactly 64 hex characters (32 bytes)",
    );
  }
  return Buffer.from(hex, "hex");
}

export interface PasswordWrap {
  encryptedWalletKey: string;
  salt: string;
}

export interface CreateWalletResult {
  address: string;
  encryptedPrivateKey: string;
  wekPasswordWrapped: { encryptedWalletKey: string; salt: string; kdfParams: string };
  wekRecoveryWrapped: { encryptedWalletKey: string; salt: string; kdfParams: string };
  recoveryKey: string;
  // wekHex is returned so the signup flow can store an encrypted WEK in the
  // session without re-running PBKDF2. SECURITY: never log this value.
  wekHex: string;
}

export async function createEmbeddedWallet(
  password: string
): Promise<CreateWalletResult> {
  const wallet = ethers.Wallet.createRandom();
  const privateKey = wallet.privateKey;
  const address = wallet.address;

  const wekBytes = generateSecureToken(32); // 64-hex-char WEK
  const wek = Buffer.from(wekBytes, "hex");

  const encryptedPK = encryptAES(privateKey, wek);

  const passwordSalt = generateSalt();
  const passwordKey = await deriveKey(password, passwordSalt);
  const wekWrappedPassword = encryptAES(wekBytes, passwordKey);

  const recoveryKey = generateSecureToken(32);

  const recoverySalt = generateSalt();
  const recoveryKey_ = await deriveKey(recoveryKey, recoverySalt);
  const wekWrappedRecovery = encryptAES(wekBytes, recoveryKey_);

  return {
    address,
    encryptedPrivateKey: JSON.stringify(encryptedPK),
    wekPasswordWrapped: {
      encryptedWalletKey: JSON.stringify(wekWrappedPassword),
      salt: passwordSalt.toString("hex"),
      kdfParams: KDF_PARAMS_JSON,
    },
    wekRecoveryWrapped: {
      encryptedWalletKey: JSON.stringify(wekWrappedRecovery),
      salt: recoverySalt.toString("hex"),
      kdfParams: KDF_PARAMS_JSON,
    },
    recoveryKey,
    wekHex: wekBytes,
  };
}

// Derives the WEK from the password wrap and returns it as a hex string.
// SECURITY: never log the return value.
export async function deriveWekFromPasswordWrap(
  wrap: PasswordWrap,
  password: string
): Promise<string> {
  const salt = Buffer.from(wrap.salt, "hex");
  const derivedKey = await deriveKey(password, salt);
  return decryptAES(
    JSON.parse(wrap.encryptedWalletKey) as EncryptedData,
    derivedKey
  );
}

export async function decryptPrivateKey(
  encryptedPrivateKey: string,
  wrap: PasswordWrap,
  password: string
): Promise<string> {
  const wekHex = await deriveWekFromPasswordWrap(wrap, password);
  const wek = Buffer.from(wekHex, "hex");
  return decryptAES(JSON.parse(encryptedPrivateKey) as EncryptedData, wek);
}

// ── System wrap (SYSTEM_RECOVERY_SECRET) ─────────────────────────────────────
// The system wrap is a third encryption of the WEK stored at signup.
// It lets resetPassword re-wrap the WEK with the new password without
// requiring the user's recovery key.
//
// Key derivation: HKDF-SHA256(SYSTEM_RECOVERY_SECRET, perUserSalt, info, 32)
// Per-user salt ensures independent ciphertexts even if the secret leaks.
// AES-GCM tag prevents silent mis-decryption across users.
//
// SECURITY: wekHex is never logged. getSystemRecoverySecret() is never logged.

export async function createSystemWrap(wekHex: string): Promise<{
  encryptedWalletKey: string;
  salt: string;
  kdfParams: string;
}> {
  const secret = getSystemRecoverySecret();
  const salt = generateSalt();
  const systemKey = await deriveHkdfKey(secret, salt, SYSTEM_WRAP_INFO, 32);
  const encrypted = encryptAES(wekHex, systemKey);
  return {
    encryptedWalletKey: JSON.stringify(encrypted),
    salt: salt.toString("hex"),
    kdfParams: SYSTEM_WRAP_KDF_PARAMS,
  };
}

export async function decryptWekFromSystemWrap(wrap: {
  encryptedWalletKey: string;
  salt: string;
}): Promise<string> {
  const secret = getSystemRecoverySecret();
  const salt = Buffer.from(wrap.salt, "hex");
  const systemKey = await deriveHkdfKey(secret, salt, SYSTEM_WRAP_INFO, 32);
  return decryptAES(JSON.parse(wrap.encryptedWalletKey) as EncryptedData, systemKey);
}

// Decrypts WEK from the SYSTEM wrap, then re-wraps it with the new password.
// Returns both wekHex (for immediate session use) and the new PASSWORD wrap.
// SECURITY: neither wekHex nor the derived keys are logged.
export async function rewrapWekWithPasswordFromSystem(
  systemWrap: { encryptedWalletKey: string; salt: string },
  newPassword: string,
): Promise<{
  wekHex: string;
  newPasswordWrap: { encryptedWalletKey: string; salt: string; kdfParams: string };
}> {
  const wekHex = await decryptWekFromSystemWrap(systemWrap);
  const newSalt = generateSalt();
  const newPasswordKey = await deriveKey(newPassword, newSalt);
  const newWrap = encryptAES(wekHex, newPasswordKey);
  return {
    wekHex,
    newPasswordWrap: {
      encryptedWalletKey: JSON.stringify(newWrap),
      salt: newSalt.toString("hex"),
      kdfParams: KDF_PARAMS_JSON,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function rewrapWekWithNewPassword(
  recoveryWrap: PasswordWrap,
  recoveryKey: string,
  newPassword: string
): Promise<{ encryptedWalletKey: string; salt: string; kdfParams: string }> {
  const recoverySalt = Buffer.from(recoveryWrap.salt, "hex");
  const recoveryDerivedKey = await deriveKey(recoveryKey, recoverySalt);
  const wekHex = decryptAES(
    JSON.parse(recoveryWrap.encryptedWalletKey) as EncryptedData,
    recoveryDerivedKey
  );

  const newSalt = generateSalt();
  const newDerivedKey = await deriveKey(newPassword, newSalt);
  const newWrap = encryptAES(wekHex, newDerivedKey);

  return {
    encryptedWalletKey: JSON.stringify(newWrap),
    salt: newSalt.toString("hex"),
    kdfParams: KDF_PARAMS_JSON,
  };
}
