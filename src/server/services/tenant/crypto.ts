import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual,
} from "crypto";

/**
 * Application-layer encryption at rest for tenant KYC fields (bank account
 * numbers, NINs, trustee ID numbers) — spec §6. AES-256-GCM with a key from
 * the environment. In production the key comes from a KMS/Vault and is
 * injected as CHMS_ENCRYPTION_KEY (base64 or hex, 32 bytes). The sandbox
 * falls back to a derived dev key with a one-time warning — the FORMAT of the
 * ciphertext never changes, so rotating in a real key re-encrypts cleanly.
 *
 * Ciphertext format: enc.v1:<iv.b64>:<authTag.b64>:<cipher.b64>
 * The "enc.v1" prefix makes keys/algos versionable without a migration.
 */

const PREFIX = "enc.v1";
let warned = false;

function encryptionKey(): Buffer {
  const raw = process.env.CHMS_ENCRYPTION_KEY?.trim();
  if (raw) {
    // accept hex (64 chars), base64 (44 chars) or any passphrase (derive)
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
    return createHash("sha256").update(raw).digest();
  }
  if (!warned) {
    warned = true;
    console.warn("[tenant/crypto] CHMS_ENCRYPTION_KEY not set — using derived DEV key. Set a real 32-byte key (KMS/Vault) before production.");
  }
  return createHash("sha256").update("grace-chms/dev-only/tenant-kyc-encryption").digest();
}

/** Encrypt a sensitive identifier for storage. Empty/null → null. */
export function encryptField(plain: string | null | undefined): string | null {
  const value = (plain ?? "").trim();
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt an enc.v1 payload. Returns null when absent/corrupt (never throws). */
export function decryptField(payload: string | null | undefined): string | null {
  const raw = (payload ?? "").trim();
  if (!raw.startsWith(`${PREFIX}:`)) return null;
  try {
    const [, ivB64, tagB64, dataB64] = raw.split(":");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

/** Display mask — Nigerian bank accounts are 10 digits; show last 3 only. */
export function maskSensitive(value: string | null | undefined, keepLast = 3): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const visible = Math.min(keepLast, Math.max(0, v.length - 4));
  return "•".repeat(Math.max(4, v.length - visible)) + v.slice(v.length - visible);
}

/** Is this string already an enc.v1 payload (idempotency guard)? */
export function isEncrypted(value: string | null | undefined): boolean {
  return (value ?? "").startsWith(`${PREFIX}:`);
}

// ── HMAC signing for partner document links ─────────────────────────────────
// The signing secret is domain-separated from the AES encryption key but
// derived from the SAME env key material (CHMS_ENCRYPTION_KEY), so rotating
// the deployment secret rotates both without a second configuration point.

function signingKey(): Buffer {
  return createHash("sha256").update(encryptionKey()).update("partner-document-url-signing/v1").digest();
}

/**
 * Sign a short-lived access token for one compliance document.
 * Token format: `<expiresEpochMs>.<hmacSha256Hex(secret, fileId + "." + expires)>`.
 */
export function signDocumentToken(fileId: string, ttlMs = 5 * 60 * 1000): { token: string; expiresAt: Date } {
  const expires = Date.now() + Math.max(1000, ttlMs);
  const mac = createHmac("sha256", signingKey()).update(`${fileId}.${expires}`).digest("hex");
  return { token: `${expires}.${mac}`, expiresAt: new Date(expires) };
}

/** Constant-time check of a signed document token for `fileId` (unexpired). */
export function verifyDocumentToken(fileId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expires = Number(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!Number.isSafeInteger(expires) || expires < Date.now()) return false;
  const expected = createHmac("sha256", signingKey()).update(`${fileId}.${expires}`).digest("hex");
  const given = Buffer.from(mac, "hex");
  const want = Buffer.from(expected, "hex");
  return given.length === want.length && timingSafeEqual(given, want);
}
