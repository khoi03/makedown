import { describe, it, expect } from "vitest";
import { blendedPrice, estimateCostUsd, normalizeModelId } from "./pricing.js";

describe("blendedPrice", () => {
  it("averages the input + output rate for a known model", () => {
    expect(blendedPrice("anthropic:claude-haiku-4-5", "anthropic")).toBe(3); // (1+5)/2
    expect(blendedPrice("claude-opus-4-8", "anthropic")).toBe(15); // (5+25)/2
  });

  it("strips a known provider prefix before lookup", () => {
    expect(blendedPrice("anthropic:claude-sonnet-4-6", "anthropic")).toBe(9); // (3+15)/2
  });

  it("returns undefined for unpriced models (never fabricates a price)", () => {
    expect(blendedPrice("openai:gpt-5", "anthropic")).toBeUndefined();
    expect(blendedPrice("some-future-model", "anthropic")).toBeUndefined();
  });
});

describe("estimateCostUsd (re-homed from anthropic)", () => {
  it("still computes from the confirmed table", () => {
    expect(estimateCostUsd("claude-sonnet-4-6", 1_000_000, 0)).toBe(3);
    expect(normalizeModelId("cc/claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
});
