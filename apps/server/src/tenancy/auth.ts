/**
 * Credential and session primitives — built exclusively on Node's standard
 * `crypto` module (scrypt KDF + CSPRNG). No homemade cryptography: passwords are
 * salted and hashed with scrypt (a memory-hard KDF), verified in constant time;
 * session tokens are 256 bits of CSPRNG output and are persisted only as a
 * SHA-256 digest so a database leak never exposes a usable token.
 */
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/** scrypt cost parameters. N must be a power of two; these are OWASP-aligned. */
const SCRYPT_N = 16384; // 2^14 CPU/memory cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32; // 256 bits

/**
 * Hash a password for storage. Returns a self-describing string encoding the
 * KDF parameters and salt: `scrypt$N$r$p$<salt-b64>$<hash-b64>`. The encoded
 * params let {@link verifyPassword} recompute even if the defaults change later.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password must not be empty");
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_LEN);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a password against a stored {@link hashPassword} value. Constant-time;
 * returns `false` (never throws) on any malformed input so callers can treat a
 * bad credential and a corrupt record identically.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const saltB64 = parts[4];
    const hashB64 = parts[5];
    if (!saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = await scrypt(password, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** A fresh, URL-safe, 256-bit session token (the raw secret handed to a client). */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/**
 * The digest stored server-side for a session token. Only the hash is persisted,
 * so a DB compromise can't be replayed as a live session. SHA-256 is appropriate
 * here (the input is already high-entropy, so a slow KDF is unnecessary).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
