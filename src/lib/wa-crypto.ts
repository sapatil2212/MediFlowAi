// ─────────────────────────────────────────────────────────────────────────────
// wa-crypto.ts  (server-only)
//
// AES-256-GCM encryption for Meta WhatsApp Cloud API secrets at rest
// (accessToken, appSecret). Encrypted blobs are stored in WaCloudConfig and
// NEVER returned to any client, logged, or thrown in a message.
//
// Blob format:  "${ivB64}:${tagB64}:${dataB64}"  (all base64)
//   iv  = 12 random bytes
//   tag = 16-byte GCM auth tag
//
// Key: WA_CLOUD_ENC_KEY env var, decoding (hex OR base64) to exactly 32 bytes.
// The optional `key` parameter lets tests inject a fixed key without mutating
// process.env. Decrypted plaintext is never logged or embedded in an error.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Decodes a candidate key string to a 32-byte Buffer, or null if it does not
 * decode (as hex or base64) to exactly 32 bytes.
 */
function decodeKey(raw: string | undefined | null): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try hex first (64 hex chars → 32 bytes).
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_BYTES * 2) {
    try {
      const buf = Buffer.from(trimmed, "hex");
      if (buf.length === KEY_BYTES) return buf;
    } catch {
      /* fall through to base64 */
    }
  }

  // Try base64 (accepts standard and url-safe).
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === KEY_BYTES) return buf;
  } catch {
    /* not base64 */
  }

  return null;
}

/** Resolves the encryption key from the arg or WA_CLOUD_ENC_KEY. Throws if absent/invalid. */
function resolveKey(key?: Buffer): Buffer {
  if (key) {
    if (key.length !== KEY_BYTES) {
      throw new Error("Invalid encryption key length");
    }
    return key;
  }
  const decoded = decodeKey(process.env.WA_CLOUD_ENC_KEY);
  if (!decoded) {
    throw new Error("Encryption key not configured");
  }
  return decoded;
}

/** True only when WA_CLOUD_ENC_KEY decodes (hex or base64) to exactly 32 bytes. */
export function isEncKeyConfigured(): boolean {
  return decodeKey(process.env.WA_CLOUD_ENC_KEY) !== null;
}

/** Encrypts a plaintext secret, returning "iv:tag:ciphertext" (all base64). */
export function encryptSecret(plain: string, key?: Buffer): string {
  const k = resolveKey(key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, k, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

/**
 * Decrypts a blob produced by {@link encryptSecret}. Throws on tamper, wrong
 * key, or malformed blob. Never includes the plaintext in the thrown message.
 */
export function decryptSecret(blob: string, key?: Buffer): string {
  const k = resolveKey(key);
  const parts = typeof blob === "string" ? blob.split(":") : [];
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted blob");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error("Malformed encrypted blob");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, k, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString("utf8");
}

/** Last 4 characters of a secret, for masked UI persistence. */
export function last4(plain: string): string {
  if (!plain) return "";
  return plain.slice(-4);
}
