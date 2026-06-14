import { describe, it, expect } from "vitest";
import { fallbackNote } from "./provenance.js";

describe("fallbackNote", () => {
  it("describes the original model when a fallback occurred", () => {
    expect(fallbackNote({ fellBack: true, requestedModel: "anthropic:claude-opus-4-8" })).toBe(
      "fell back from anthropic:claude-opus-4-8",
    );
  });

  it("returns undefined when no fallback occurred", () => {
    expect(fallbackNote({})).toBeUndefined();
    expect(fallbackNote({ fellBack: false, requestedModel: "x" })).toBeUndefined();
  });

  it("returns undefined when the requested model is unknown", () => {
    expect(fallbackNote({ fellBack: true })).toBeUndefined();
  });
});
