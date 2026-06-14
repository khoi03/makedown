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

  it("matches a dated/gateway model snapshot to its base price", () => {
    // cc/ gateway prefix + -YYYYMMDD snapshot suffix both reduce to the base id.
    expect(estimateCostUsd("cc/claude-haiku-4-5-20251001", 1_000_000, 0)).toBe(1);
    expect(estimateCostUsd("claude-opus-4-8-20260115", 1_000_000, 1_000_000)).toBe(30);
  });

  it("never reports a cost for an OpenAI-compatible model (cost varies by endpoint)", () => {
    expect(estimateCostUsd("gpt-4o", 1_000_000, 1_000_000)).toBeUndefined();
  });
});

describe("blendedPrice with dated ids + OpenAI ordering prices", () => {
  it("orders a dated Anthropic snapshot by its base price", () => {
    expect(blendedPrice("anthropic:cc/claude-haiku-4-5-20251001", "anthropic")).toBe(3); // (1+5)/2
  });

  it("orders known OpenAI models by their public list price (ordering only)", () => {
    expect(blendedPrice("openai:gpt-4o", "anthropic")).toBe(6.25); // (2.5+10)/2
    expect(blendedPrice("openai:gpt-4o-mini", "anthropic")).toBeCloseTo(0.375, 5); // (0.15+0.6)/2
  });

  it("leaves an unknown OpenAI model unpriced (no fabrication → sorts last)", () => {
    expect(blendedPrice("openai:some-unlisted-model", "anthropic")).toBeUndefined();
  });
});
