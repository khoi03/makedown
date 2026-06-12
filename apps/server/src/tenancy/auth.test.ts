import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashToken,
} from "./auth.js";

/**
 * Credential + session primitives built on node:crypto only (scrypt KDF +
 * CSPRNG tokens). No homemade cryptography — these tests pin the security
 * contract: salted/slow password hashing, constant-time verify that never
 * throws on bad input, and session tokens that are stored only as a hash.
 */
describe("hashPassword / verifyPassword", () => {
  it("verifies a correct password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("s3cret-pass");
    expect(await verifyPassword("wrong-pass", stored)).toBe(false);
  });

  it("salts — the same password hashes to different stored values each time", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    // ...yet both still verify
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("encodes the KDF parameters so the format is self-describing", async () => {
    const stored = await hashPassword("x");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored.split("$")).toHaveLength(6); // scrypt$N$r$p$salt$hash
  });

  it("returns false (never throws) on a malformed stored value", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-valid-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$bad$params")).toBe(false);
  });

  it("rejects an empty password at hash time", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});

describe("session tokens", () => {
  it("generates unique, high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateSessionToken()));
    expect(tokens.size).toBe(100);
    for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(32);
  });

  it("hashes a token deterministically and irreversibly (store the hash, not the token)", () => {
    const token = generateSessionToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
