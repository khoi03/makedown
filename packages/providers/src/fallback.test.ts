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

  it("cost-aware sorts unknown-priced models last, stably", () => {
    const chain = buildChain(
      "p",
      ["openai:gpt-5", "anthropic:claude-haiku-4-5", "openai:gpt-4o"],
      "cost-aware",
      "anthropic",
    );
    expect(chain).toEqual(["p", "anthropic:claude-haiku-4-5", "openai:gpt-5", "openai:gpt-4o"]);
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
    const result = await runWithFallback(["a", "b"], run);
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
    await expect(runWithFallback(["a", "b"], run)).rejects.toThrow(
      /All 2 models failed.*a.*overload.*b.*overload/s,
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rethrows the raw error for a single-candidate chain", async () => {
    const err = new ProviderError("nope", "rate_limit", "x", 429);
    await expect(runWithFallback(["a"], async () => Promise.reject(err))).rejects.toBe(err);
  });
});
