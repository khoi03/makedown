import { describe, it, expect } from "vitest";
import { parseBuildDoc, refsInBody, BuildDocParseError } from "./parse.js";
import { serializeBuildDoc } from "./serialize.js";

const DOC = `---
defaults:
  model: claude-opus-4-8
  params: { temperature: 0 }
artifacts_dir: artifacts
---

# A pipeline

## target: summary
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
cache: deterministic
\`\`\`
Summarize {{sources/notes.md}} in three bullets.

## target: review
\`\`\`yaml
inputs: [summary, sources/spec.md]
step: chat
cache: stochastic(n=3)
\`\`\`
Review {{summary}} against {{sources/spec.md}}.
`;

describe("parseBuildDoc", () => {
  it("parses front matter defaults", () => {
    const doc = parseBuildDoc(DOC);
    expect(doc.frontMatter.artifactsDir).toBe("artifacts");
    expect(doc.frontMatter.defaults?.model).toBe("claude-opus-4-8");
  });

  it("extracts targets with merged defaults and default output paths", () => {
    const doc = parseBuildDoc(DOC);
    expect(doc.targets.map((t) => t.name)).toEqual(["summary", "review"]);
    const summary = doc.targets[0]!;
    expect(summary.header.model).toBe("claude-opus-4-8");
    expect(summary.header.params).toMatchObject({ temperature: 0 });
    expect(summary.header.output).toBe("artifacts/summary.md");
    expect(summary.header.cache).toEqual({ kind: "deterministic" });
  });

  it("parses stochastic cache policy", () => {
    const doc = parseBuildDoc(DOC);
    expect(doc.targets[1]!.header.cache).toEqual({ kind: "stochastic", n: 3 });
  });

  it("rejects undeclared {{refs}} in strict mode", () => {
    const bad = `## target: t\n\`\`\`yaml\ninputs: []\n\`\`\`\nUse {{sources/x.md}}.\n`;
    expect(() => parseBuildDoc(bad)).toThrow(BuildDocParseError);
  });

  it("requires an agent: id for step: agent", () => {
    const bad = `## target: t\n\`\`\`yaml\ninputs: []\nstep: agent\n\`\`\`\nDo the thing.\n`;
    expect(() => parseBuildDoc(bad)).toThrow(/agent/i);
  });

  it("defaults agent targets to cache: always (non-deterministic, side-effectful)", () => {
    const doc = parseBuildDoc(
      `## target: t\n\`\`\`yaml\ninputs: []\nstep: agent\nagent: claude-code\n\`\`\`\nDo it.\n`,
    );
    expect(doc.targets[0]!.header.cache).toEqual({ kind: "always" });
  });

  it("round-trips through the serializer", () => {
    const once = parseBuildDoc(DOC);
    const twice = parseBuildDoc(serializeBuildDoc(once));
    expect(twice.targets.map((t) => t.name)).toEqual(once.targets.map((t) => t.name));
    expect(twice.targets[1]!.header.cache).toEqual(once.targets[1]!.header.cache);
  });

  it("parses a fallback chain and route policy", () => {
    const doc = parseBuildDoc(
      `## target: t\n\`\`\`yaml\ninputs: []\nstep: chat\nmodel: anthropic:claude-opus-4-8\nfallback: [anthropic:claude-sonnet-4-6, openai:gpt-5]\nroute: cost-aware\n\`\`\`\nHi.\n`,
    );
    const header = doc.targets[0]!.header;
    expect(header.fallback).toEqual(["anthropic:claude-sonnet-4-6", "openai:gpt-5"]);
    expect(header.route).toBe("cost-aware");
  });

  it("leaves fallback/route undefined when not declared", () => {
    const doc = parseBuildDoc(`## target: t\n\`\`\`yaml\ninputs: []\nstep: chat\n\`\`\`\nHi.\n`);
    expect(doc.targets[0]!.header.fallback).toBeUndefined();
    expect(doc.targets[0]!.header.route).toBeUndefined();
  });

  it("rejects an unknown route policy", () => {
    const bad = `## target: t\n\`\`\`yaml\ninputs: []\nstep: chat\nroute: cheapest\n\`\`\`\nHi.\n`;
    expect(() => parseBuildDoc(bad)).toThrow(BuildDocParseError);
  });

  it("applies a front-matter default fallback + route to targets that omit their own", () => {
    const doc = parseBuildDoc(
      `---\ndefaults:\n  model: anthropic:claude-opus-4-8\n  fallback: [anthropic:claude-sonnet-4-6]\n  route: cost-aware\nartifacts_dir: artifacts\n---\n\n## target: inherits\n\`\`\`yaml\ninputs: []\nstep: chat\n\`\`\`\nHi.\n\n## target: overrides\n\`\`\`yaml\ninputs: []\nstep: chat\nfallback: [openai:gpt-5]\nroute: strict\n\`\`\`\nHi.\n`,
    );
    const inherits = doc.targets.find((t) => t.name === "inherits")!.header;
    expect(inherits.fallback).toEqual(["anthropic:claude-sonnet-4-6"]);
    expect(inherits.route).toBe("cost-aware");

    const overrides = doc.targets.find((t) => t.name === "overrides")!.header;
    expect(overrides.fallback).toEqual(["openai:gpt-5"]); // target wins over the default
    expect(overrides.route).toBe("strict");
  });

  it("round-trips fallback + route through the serializer", () => {
    const doc = parseBuildDoc(
      `## target: t\n\`\`\`yaml\ninputs: []\nstep: chat\nmodel: anthropic:claude-opus-4-8\nfallback: [anthropic:claude-haiku-4-5]\nroute: cost-aware\n\`\`\`\nHi.\n`,
    );
    const reparsed = parseBuildDoc(serializeBuildDoc(doc)).targets[0]!.header;
    expect(reparsed.fallback).toEqual(["anthropic:claude-haiku-4-5"]);
    expect(reparsed.route).toBe("cost-aware");
  });
});

describe("refsInBody", () => {
  it("collects refs and strips transform suffixes", () => {
    expect(refsInBody("a {{x}} b {{sources/d.csv:head(20)}}").sort()).toEqual([
      "sources/d.csv",
      "x",
    ]);
  });
});
