import { describe, it, expect } from "vitest";
import type { RecipeHeader } from "@makedown/shared";
import { sha256, canonicalJson, computeIdentityHash } from "./hash.js";

const header = (over: Partial<RecipeHeader> = {}): RecipeHeader => ({
  inputs: ["sources/x.md"],
  step: "chat",
  model: "claude-opus-4-8",
  params: { temperature: 0 },
  output: "artifacts/t.md",
  cache: { kind: "deterministic" },
  sandbox: "worktree",
  approval: "none",
  ...over,
});

describe("sha256", () => {
  it("prefixes with sha256: and is stable", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("hello").startsWith("sha256:")).toBe(true);
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

describe("canonicalJson", () => {
  it("is key-order independent", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it("differs when a value changes", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});

describe("computeIdentityHash", () => {
  const base = { inputHashes: ["sha256:1"], header: header(), body: "b" };

  it("is stable for identical inputs", () => {
    expect(computeIdentityHash(base)).toBe(computeIdentityHash({ ...base, header: header() }));
  });
  it("changes when the body changes", () => {
    expect(computeIdentityHash(base)).not.toBe(computeIdentityHash({ ...base, body: "c" }));
  });
  it("changes when an input hash changes", () => {
    expect(computeIdentityHash(base)).not.toBe(
      computeIdentityHash({ ...base, inputHashes: ["sha256:2"] }),
    );
  });
  it("changes when the model changes", () => {
    expect(computeIdentityHash(base)).not.toBe(
      computeIdentityHash({ ...base, header: header({ model: "claude-haiku-4-5" }) }),
    );
  });
  it("changes when params change", () => {
    expect(computeIdentityHash(base)).not.toBe(
      computeIdentityHash({ ...base, header: header({ params: { temperature: 1 } }) }),
    );
  });
  it("ignores the output path (presentation only, not computation)", () => {
    expect(computeIdentityHash(base)).toBe(
      computeIdentityHash({ ...base, header: header({ output: "artifacts/other.md" }) }),
    );
  });
});
