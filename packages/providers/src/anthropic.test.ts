import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK so complete() can be tested without a live API call.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
    constructor(_opts: unknown) {}
  },
}));

import { AnthropicProvider, estimateCostUsd } from "./anthropic.js";

beforeEach(() => {
  createMock.mockReset();
});

describe("estimateCostUsd", () => {
  it("computes cost from the confirmed pricing table", () => {
    // 1M input @ $5 + 1M output @ $25 = $30
    expect(estimateCostUsd("claude-opus-4-8", 1_000_000, 1_000_000)).toBe(30);
    // Haiku: 1M input @ $1 + 1M output @ $5 = $6
    expect(estimateCostUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBe(6);
  });

  it("scales linearly with token counts", () => {
    expect(estimateCostUsd("claude-sonnet-4-6", 500_000, 0)).toBe(1.5);
  });

  it("returns undefined for an unknown model (never fabricates a price)", () => {
    expect(estimateCostUsd("some-future-model", 100, 100)).toBeUndefined();
  });
});

describe("AnthropicProvider.complete", () => {
  it("concatenates text blocks, sums usage, and computes cost", async () => {
    createMock.mockResolvedValue({
      content: [
        { type: "text", text: "Hello " },
        { type: "thinking", thinking: "ignored" },
        { type: "text", text: "world" },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const result = await provider.complete({
      model: "claude-opus-4-8",
      prompt: "hi",
      params: {},
    });

    expect(result.text).toBe("Hello world");
    expect(result.usage).toEqual({ input: 10, output: 20 });
    expect(result.costUsd).toBe(estimateCostUsd("claude-opus-4-8", 10, 20));
  });

  it("does NOT forward sampling params (Opus rejects temperature/seed) and defaults max_tokens", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "x" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    await provider.complete({
      model: "claude-opus-4-8",
      prompt: "the prompt",
      params: { temperature: 0, seed: 7 },
    });

    const arg = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg["model"]).toBe("claude-opus-4-8");
    expect(arg["max_tokens"]).toBe(16_000);
    expect(arg).not.toHaveProperty("temperature");
    expect(arg).not.toHaveProperty("seed");
    expect(arg["messages"]).toEqual([{ role: "user", content: "the prompt" }]);
  });

  it("honors a params.max_tokens override", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "x" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    await provider.complete({ model: "claude-opus-4-8", prompt: "p", params: { max_tokens: 512 } });

    const arg = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg["max_tokens"]).toBe(512);
  });
});
