import { describe, it, expect } from "vitest";
import { ProviderError, isRetryable, kindFromStatus } from "./errors.js";

describe("kindFromStatus", () => {
  it.each([
    [429, "rate_limit"],
    [503, "overload"],
    [408, "timeout"],
    [504, "timeout"],
    [404, "unavailable"],
    [500, "server"],
    [502, "server"],
    [401, "auth"],
    [403, "auth"],
    [400, "bad_request"],
    [422, "bad_request"],
    [418, "unknown"],
  ] as const)("maps %i to %s", (status, kind) => {
    expect(kindFromStatus(status)).toBe(kind);
  });
});

describe("isRetryable", () => {
  it.each(["rate_limit", "overload", "server", "timeout", "unavailable"] as const)(
    "treats %s as retryable",
    (kind) => {
      expect(isRetryable(new ProviderError("x", kind, "anthropic"))).toBe(true);
    },
  );

  it.each(["auth", "bad_request", "unknown"] as const)("treats %s as fatal", (kind) => {
    expect(isRetryable(new ProviderError("x", kind, "anthropic"))).toBe(false);
  });

  it("treats a plain Error as fatal (not retryable)", () => {
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable("nope")).toBe(false);
  });
});

describe("ProviderError", () => {
  it("carries kind, provider, and status", () => {
    const err = new ProviderError("rate limited", "rate_limit", "openai", 429);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ProviderError");
    expect(err.kind).toBe("rate_limit");
    expect(err.provider).toBe("openai");
    expect(err.status).toBe(429);
  });
});
