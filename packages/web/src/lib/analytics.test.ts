import { describe, it, expect } from "vitest";
import { RANGE_PRESETS, rangeFromPreset, withBarFractions, formatCount } from "./analytics.js";

describe("rangeFromPreset", () => {
  it("returns an open range for the all-time preset", () => {
    expect(rangeFromPreset(null)).toEqual({});
  });

  it("computes an ISO lower bound N days before now", () => {
    const now = new Date("2026-06-14T00:00:00.000Z");
    expect(rangeFromPreset(7, now)).toEqual({ from: "2026-06-07T00:00:00.000Z" });
  });

  it("exposes presets including an all-time option", () => {
    expect(RANGE_PRESETS.some((p) => p.days === null)).toBe(true);
    expect(RANGE_PRESETS.map((p) => p.days)).toContain(30);
  });
});

describe("withBarFractions", () => {
  it("scales each bucket's cost as a fraction of the largest", () => {
    const out = withBarFractions([
      { key: "a", costUsd: 0.5, tokensInput: 0, tokensOutput: 0, runs: 1 },
      { key: "b", costUsd: 1.0, tokensInput: 0, tokensOutput: 0, runs: 1 },
    ]);
    expect(out[0]!.fraction).toBe(0.5);
    expect(out[1]!.fraction).toBe(1);
  });

  it("is zero-safe when every cost is zero (no division by zero)", () => {
    const out = withBarFractions([
      { key: "a", costUsd: 0, tokensInput: 0, tokensOutput: 0, runs: 1 },
      { key: "b", costUsd: 0, tokensInput: 0, tokensOutput: 0, runs: 1 },
    ]);
    expect(out.every((b) => b.fraction === 0)).toBe(true);
  });

  it("preserves the input order", () => {
    const out = withBarFractions([
      { key: "x", costUsd: 1, tokensInput: 0, tokensOutput: 0, runs: 1 },
      { key: "y", costUsd: 2, tokensInput: 0, tokensOutput: 0, runs: 1 },
    ]);
    expect(out.map((b) => b.key)).toEqual(["x", "y"]);
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(0)).toBe("0");
  });
});
