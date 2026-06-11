import { describe, it, expect } from "vitest";
import { formatUsd, shortHash, formatDuration, formatTokens } from "./format.js";

describe("formatUsd", () => {
  it("shows two decimals for zero and cents-scale amounts", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
  it("shows four decimals for sub-cent amounts so small costs are visible", () => {
    expect(formatUsd(0.0421)).toBe("$0.0421");
  });
});

describe("shortHash", () => {
  it("drops the sha256: prefix and keeps the first 8 hex chars", () => {
    expect(shortHash("sha256:abcdef0123456789")).toBe("abcdef01");
  });
  it("handles a bare hash and short input", () => {
    expect(shortHash("deadbeef")).toBe("deadbeef");
    expect(shortHash("")).toBe("");
  });
});

describe("formatDuration", () => {
  it("uses ms under a second and seconds above", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(3120)).toBe("3.1s");
  });
  it("handles undefined", () => {
    expect(formatDuration(undefined)).toBe("—");
  });
});

describe("formatTokens", () => {
  it("formats input/output token counts", () => {
    expect(formatTokens({ input: 1234, output: 567 })).toBe("1,234 in · 567 out");
  });
  it("handles undefined usage", () => {
    expect(formatTokens(undefined)).toBe("—");
  });
});
