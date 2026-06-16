import { describe, it, expect } from "vitest";
import { DEFAULT_RETRY_POLICY, backoffDelayMs, type RetryPolicy } from "./retry.js";

const NO_JITTER: RetryPolicy = { ...DEFAULT_RETRY_POLICY, jitter: false };

describe("backoffDelayMs", () => {
  it("grows exponentially from the base delay (no jitter)", () => {
    expect(backoffDelayMs(1, NO_JITTER)).toBe(500); // base * 2^0
    expect(backoffDelayMs(2, NO_JITTER)).toBe(1000); // base * 2^1
    expect(backoffDelayMs(3, NO_JITTER)).toBe(2000); // base * 2^2
  });

  it("caps at maxDelayMs", () => {
    expect(backoffDelayMs(10, NO_JITTER)).toBe(NO_JITTER.maxDelayMs);
  });

  it("with equal jitter stays within [exp/2, exp]", () => {
    const exp = 1000; // attempt 2 at base 500
    expect(backoffDelayMs(2, DEFAULT_RETRY_POLICY, undefined, () => 0)).toBe(exp / 2);
    expect(backoffDelayMs(2, DEFAULT_RETRY_POLICY, undefined, () => 1)).toBe(exp);
    const mid = backoffDelayMs(2, DEFAULT_RETRY_POLICY, undefined, () => 0.5);
    expect(mid).toBeGreaterThanOrEqual(exp / 2);
    expect(mid).toBeLessThanOrEqual(exp);
  });

  it("honors a provider Retry-After hint exactly, overriding the computed backoff", () => {
    expect(backoffDelayMs(1, DEFAULT_RETRY_POLICY, 7000, () => 0.5)).toBe(7000);
  });

  it("ignores a non-positive Retry-After and falls back to the computed delay", () => {
    expect(backoffDelayMs(1, NO_JITTER, 0)).toBe(500);
  });
});

describe("DEFAULT_RETRY_POLICY", () => {
  it("uses the confirmed defaults (3 attempts, 500ms base, 8s cap, jitter on)", () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttemptsPerModel: 3,
      baseDelayMs: 500,
      maxDelayMs: 8000,
      jitter: true,
    });
  });
});
