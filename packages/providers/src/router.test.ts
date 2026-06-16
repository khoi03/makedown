import { describe, it, expect, vi, afterEach } from "vitest";
import { parseModelRef, createProviderRouter } from "./router.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { ProviderError } from "./errors.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseModelRef", () => {
  it("defaults a bare model to the default provider", () => {
    expect(parseModelRef("claude-opus-4-8", "anthropic")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-8",
    });
  });

  it("splits a known provider prefix", () => {
    expect(parseModelRef("openai:gpt-5", "anthropic")).toEqual({
      provider: "openai",
      model: "gpt-5",
    });
  });

  it("keeps slashes in the model id (e.g. OpenRouter ids)", () => {
    expect(parseModelRef("openai:meta-llama/llama-3.3-70b", "anthropic")).toEqual({
      provider: "openai",
      model: "meta-llama/llama-3.3-70b",
    });
  });

  it("treats an unknown prefix as part of the model (no false split)", () => {
    expect(parseModelRef("gpt-4:latest", "anthropic")).toEqual({
      provider: "anthropic",
      model: "gpt-4:latest",
    });
  });
});

describe("createProviderRouter", () => {
  it("errors clearly when the target's provider is not configured", async () => {
    const router = createProviderRouter({ defaultProvider: "anthropic" }); // no keys
    await expect(
      router.complete({ model: "openai:gpt-5", prompt: "x", params: {} }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("errors when a target has no model", async () => {
    const router = createProviderRouter({});
    await expect(router.complete({ model: "   ", prompt: "x", params: {} })).rejects.toThrow(
      /No model/,
    );
  });

  it("reports the requested model as the actual model on a normal (no-fallback) call", async () => {
    const router = createProviderRouter({ anthropic: { apiKey: "k" } });
    vi.spyOn(AnthropicProvider.prototype, "complete").mockResolvedValue({
      text: "ok",
      usage: { input: 1, output: 1 },
    });
    const result = await router.complete({ model: "anthropic:claude-opus-4-8", prompt: "p", params: {} });
    expect(result.model).toBe("anthropic:claude-opus-4-8");
  });

  it("falls back to the next model on a transient error and records the actual model", async () => {
    // maxAttemptsPerModel:1 isolates the advance path (per-model retry tested below).
    const router = createProviderRouter({ anthropic: { apiKey: "k" }, retry: { maxAttemptsPerModel: 1 } });
    const spy = vi
      .spyOn(AnthropicProvider.prototype, "complete")
      .mockRejectedValueOnce(new ProviderError("429", "rate_limit", "anthropic", 429))
      .mockResolvedValueOnce({ text: "second", usage: { input: 1, output: 1 } });

    const result = await router.complete({
      model: "anthropic:claude-opus-4-8",
      fallback: ["anthropic:claude-sonnet-4-6"],
      prompt: "p",
      params: {},
    });

    expect(result.text).toBe("second");
    expect(result.model).toBe("anthropic:claude-sonnet-4-6");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries the SAME model on a transient error before demoting (records the primary)", async () => {
    // 0ms backoff keeps the test instant while exercising the real retry loop.
    const router = createProviderRouter({
      anthropic: { apiKey: "k" },
      retry: { maxAttemptsPerModel: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
    });
    const spy = vi
      .spyOn(AnthropicProvider.prototype, "complete")
      .mockRejectedValueOnce(new ProviderError("429", "rate_limit", "anthropic", 429))
      .mockResolvedValueOnce({ text: "primary recovered", usage: { input: 1, output: 1 } });

    const result = await router.complete({
      model: "anthropic:claude-opus-4-8",
      fallback: ["anthropic:claude-sonnet-4-6"],
      prompt: "p",
      params: {},
    });

    expect(result.text).toBe("primary recovered");
    expect(result.model).toBe("anthropic:claude-opus-4-8"); // never demoted
    expect(spy).toHaveBeenCalledTimes(2); // both calls on the primary
  });

  it("skips an unconfigured fallback provider rather than failing the chain", async () => {
    // openai has no key; the chain should skip it and land on the anthropic fallback.
    const router = createProviderRouter({ anthropic: { apiKey: "k" } });
    vi.spyOn(AnthropicProvider.prototype, "complete").mockResolvedValue({
      text: "anthropic-served",
      usage: { input: 1, output: 1 },
    });
    const result = await router.complete({
      model: "openai:gpt-5",
      fallback: ["anthropic:claude-haiku-4-5"],
      prompt: "p",
      params: {},
    });
    expect(result.text).toBe("anthropic-served");
    expect(result.model).toBe("anthropic:claude-haiku-4-5");
  });

  it("skips an unconfigured anthropic primary and lands on a configured openai fallback", async () => {
    const router = createProviderRouter({ openai: { apiKey: "k" } }); // no anthropic key
    vi.spyOn(OpenAICompatibleProvider.prototype, "complete").mockResolvedValue({
      text: "openai-served",
      usage: { input: 1, output: 1 },
    });
    const result = await router.complete({
      model: "anthropic:claude-opus-4-8",
      fallback: ["openai:gpt-5"],
      prompt: "p",
      params: {},
    });
    expect(result.text).toBe("openai-served");
    expect(result.model).toBe("openai:gpt-5");
  });

  it("fails fatally on an unknown default provider", async () => {
    const router = createProviderRouter({ defaultProvider: "mystery" });
    await expect(
      router.complete({ model: "bare-model", prompt: "p", params: {} }),
    ).rejects.toMatchObject({ kind: "bad_request" });
  });

  it("does not retry on a fatal (bad request) error", async () => {
    const router = createProviderRouter({ anthropic: { apiKey: "k" } });
    const spy = vi
      .spyOn(AnthropicProvider.prototype, "complete")
      .mockRejectedValue(new ProviderError("bad", "bad_request", "anthropic", 400));
    await expect(
      router.complete({
        model: "anthropic:claude-opus-4-8",
        fallback: ["anthropic:claude-sonnet-4-6"],
        prompt: "p",
        params: {},
      }),
    ).rejects.toMatchObject({ kind: "bad_request" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
