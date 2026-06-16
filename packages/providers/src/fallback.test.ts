import { describe, it, expect, vi } from "vitest";
import { buildChain, runWithFallback } from "./fallback.js";
import { ProviderError } from "./errors.js";
import type { CompletionResult } from "./provider.js";

const ok = (model?: string): CompletionResult => ({
  text: "out",
  usage: { input: 1, output: 1 },
  ...(model ? { model } : {}),
});

describe("buildChain", () => {
  it("puts the primary first with fallbacks in declared order (strict)", () => {
    expect(buildChain("a", ["b", "c"], "strict", "anthropic")).toEqual(["a", "b", "c"]);
  });

  it("returns just the primary when there are no fallbacks", () => {
    expect(buildChain("a", undefined, undefined, "anthropic")).toEqual(["a"]);
  });

  it("dedupes repeated refs, keeping the earliest position", () => {
    expect(buildChain("a", ["a", "b", "b"], "strict", "anthropic")).toEqual(["a", "b"]);
  });

  it("cost-aware keeps the primary first but sorts fallbacks cheapest-first", () => {
    // blended USD/1M: opus (5+25)/2=15, sonnet (3+15)/2=9, haiku (1+5)/2=3
    const chain = buildChain(
      "anthropic:claude-opus-4-8",
      ["anthropic:claude-sonnet-4-6", "anthropic:claude-haiku-4-5"],
      "cost-aware",
      "anthropic",
    );
    expect(chain).toEqual([
      "anthropic:claude-opus-4-8",
      "anthropic:claude-haiku-4-5",
      "anthropic:claude-sonnet-4-6",
    ]);
  });

  it("cost-aware sorts priced models ascending and unpriced models last, stably", () => {
    // haiku (3) < gpt-4o (6.25) < the two unpriced models, which keep declared order.
    const chain = buildChain(
      "p",
      ["openai:unlisted-a", "anthropic:claude-haiku-4-5", "openai:gpt-4o", "openai:unlisted-b"],
      "cost-aware",
      "anthropic",
    );
    expect(chain).toEqual([
      "p",
      "anthropic:claude-haiku-4-5",
      "openai:gpt-4o",
      "openai:unlisted-a",
      "openai:unlisted-b",
    ]);
  });
});

describe("runWithFallback", () => {
  it("returns the first success and stamps the model when the runner omits it", async () => {
    const run = vi.fn(async () => ok());
    const result = await runWithFallback(["a", "b"], run);
    expect(result.model).toBe("a");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("preserves a model the runner already reported", async () => {
    const result = await runWithFallback(["a"], async () => ok("explicit"));
    expect(result.model).toBe("explicit");
  });

  it("advances to the next model on a retryable error", async () => {
    const run = vi.fn(async (m: string) => {
      if (m === "a") throw new ProviderError("429", "rate_limit", "anthropic", 429);
      return ok();
    });
    // maxAttemptsPerModel:1 isolates advance behavior (per-model retry is tested below).
    const result = await runWithFallback(["a", "b"], run, { retry: { maxAttemptsPerModel: 1 } });
    expect(result.model).toBe("b");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stops immediately on a fatal error without trying the rest", async () => {
    const run = vi.fn(async () => {
      throw new ProviderError("400", "bad_request", "openai", 400);
    });
    await expect(runWithFallback(["a", "b"], run)).rejects.toMatchObject({ kind: "bad_request" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("throws an aggregate error when the whole chain fails transiently", async () => {
    const run = vi.fn(async (m: string) => {
      throw new ProviderError(`${m} down`, "overload", "x", 503);
    });
    await expect(
      runWithFallback(["a", "b"], run, { retry: { maxAttemptsPerModel: 1 } }),
    ).rejects.toThrow(/All 2 models failed.*a.*overload.*b.*overload/s);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rethrows the raw error for a single-candidate chain", async () => {
    const err = new ProviderError("nope", "rate_limit", "x", 429);
    await expect(
      runWithFallback(["a"], async () => Promise.reject(err), { sleep: async () => {} }),
    ).rejects.toBe(err);
  });
});

describe("runWithFallback per-model retry/backoff", () => {
  const noSleep = async (): Promise<void> => {};

  it("retries the SAME model on a transient error, then succeeds (never demotes)", async () => {
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new ProviderError("rl", "rate_limit", "x", 429);
      return ok();
    });
    const result = await runWithFallback(["a", "b"], run, { sleep: noSleep });
    expect(result.model).toBe("a"); // succeeded on the requested model
    expect(run).toHaveBeenCalledTimes(3); // 2 transient failures + 1 success, all on "a"
  });

  it("advances to the next model after exhausting same-model attempts", async () => {
    const run = vi.fn(async (m: string) => {
      if (m === "a") throw new ProviderError("rl", "rate_limit", "x", 429);
      return ok();
    });
    const result = await runWithFallback(["a", "b"], run, {
      sleep: noSleep,
      retry: { maxAttemptsPerModel: 2 },
    });
    expect(result.model).toBe("b");
    expect(run.mock.calls.filter((c) => c[0] === "a")).toHaveLength(2); // exhausted on "a"
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry the same model when it is unavailable — advances immediately", async () => {
    const run = vi.fn(async (m: string) => {
      if (m === "a") throw new ProviderError("404", "unavailable", "x", 404);
      return ok();
    });
    const result = await runWithFallback(["a", "b"], run, { sleep: noSleep });
    expect(result.model).toBe("b");
    expect(run.mock.calls.filter((c) => c[0] === "a")).toHaveLength(1); // no same-model retry
  });

  it("sleeps the provider's Retry-After hint before retrying the same model", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
    };
    let calls = 0;
    const run = async (): Promise<CompletionResult> => {
      calls += 1;
      if (calls === 1) {
        throw new ProviderError("rl", "rate_limit", "x", 429, { retryAfterMs: 4000 });
      }
      return ok();
    };
    await runWithFallback(["a"], run, { sleep });
    expect(delays).toEqual([4000]);
  });
});
