import crypto from "node:crypto";

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function encryptAES(plaintext: string, key: Buffer): EncryptedData {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptAES(data: EncryptedData, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(data.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(data.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(data.ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export const KDF_PARAMS = {
  iterations: 310_000,
  keyLength: 32,
  digest: "sha512" as const,
};

export async function deriveKey(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      secret,
      salt,
      KDF_PARAMS.iterations,
      KDF_PARAMS.keyLength,
      KDF_PARAMS.digest,
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

export function generateSalt(bytes = 32): Buffer {
  return crypto.randomBytes(bytes);
}

// HKDF-SHA256 key derivation — used for the SYSTEM wrap where the IKM is
// already high-entropy (SYSTEM_RECOVERY_SECRET), making PBKDF2 iterations
// unnecessary.
export async function deriveHkdfKey(
  ikm: Buffer,
  salt: Buffer,
  info: string,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.hkdf(
      "sha256",
      ikm,
      salt,
      Buffer.from(info, "utf8"),
      keyLength,
      (err, key) => (err ? reject(err) : resolve(Buffer.from(key))),
    );
  });
}
