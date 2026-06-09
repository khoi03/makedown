import { describe, it, expect } from "vitest";
import {
  colorEnabled,
  makeStyler,
  visibleLength,
  padCell,
  formatUsd,
  formatTokens,
} from "./format.js";

describe("colorEnabled", () => {
  it("disables color when NO_COLOR is set", () => {
    expect(colorEnabled({ NO_COLOR: "1" }, true)).toBe(false);
  });
  it("force-enables color with FORCE_COLOR even without a TTY", () => {
    expect(colorEnabled({ FORCE_COLOR: "1" }, false)).toBe(true);
  });
  it("disables color for a dumb terminal", () => {
    expect(colorEnabled({ TERM: "dumb" }, true)).toBe(false);
  });
  it("follows the TTY flag by default", () => {
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({}, false)).toBe(false);
  });
});

describe("makeStyler", () => {
  it("is an identity transform when disabled", () => {
    const s = makeStyler(false);
    expect(s.green("ok")).toBe("ok");
    expect(s.enabled).toBe(false);
  });
  it("wraps text in ANSI codes when enabled", () => {
    const s = makeStyler(true);
    expect(s.green("ok")).toBe("\x1b[32mok\x1b[0m");
  });
});

describe("visibleLength / padCell", () => {
  it("ignores ANSI codes when measuring", () => {
    const s = makeStyler(true);
    expect(visibleLength(s.red("abc"))).toBe(3);
  });
  it("pads to the visible width", () => {
    expect(padCell("ab", 5)).toBe("ab   ");
    const s = makeStyler(true);
    expect(visibleLength(padCell(s.red("ab"), 5))).toBe(5);
  });
});

describe("formatUsd", () => {
  it("formats amounts and edge cases", () => {
    expect(formatUsd(undefined)).toBe("—");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(1.2345)).toBe("$1.23");
  });
});

describe("formatTokens", () => {
  it("adds k/M suffixes", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(23_000)).toBe("23k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});
