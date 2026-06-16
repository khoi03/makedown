import { describe, it, expect } from "vitest";
import {
  ProviderError,
  isRetryable,
  kindFromStatus,
  shouldRetrySameModel,
  parseRetryAfter,
} from "./errors.js";

describe("shouldRetrySameModel", () => {
  it.each(["rate_limit", "overload", "server", "timeout"] as const)(
    "retries the same model on transient load/throttle/network error (%s)",
    (kind) => {
      expect(shouldRetrySameModel(new ProviderError("x", kind, "anthropic"))).toBe(true);
    },
  );

  it("does NOT retry the same model when the model is unavailable (advance instead)", () => {
    expect(shouldRetrySameModel(new ProviderError("x", "unavailable", "anthropic"))).toBe(false);
  });

  it.each(["auth", "bad_request", "unknown"] as const)("does not retry fatal kinds (%s)", (kind) => {
    expect(shouldRetrySameModel(new ProviderError("x", kind, "anthropic"))).toBe(false);
  });

  it("does not retry plain errors", () => {
    expect(shouldRetrySameModel(new Error("boom"))).toBe(false);
  });
});

describe("ProviderError.retryAfterMs", () => {
  it("carries an optional retry-after hint", () => {
    const err = new ProviderError("rl", "rate_limit", "openai", 429, { retryAfterMs: 2000 });
    expect(err.retryAfterMs).toBe(2000);
    expect(err.kind).toBe("rate_limit");
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds into milliseconds", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("reads from a Headers-like getter", () => {
    const headers = new Headers({ "retry-after": "3" });
    expect(parseRetryAfter(headers)).toBe(3000);
  });

  it("returns undefined for missing/garbage values", () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter("not-a-number")).toBeUndefined();
    expect(parseRetryAfter(new Headers())).toBeUndefined();
  });
});

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
