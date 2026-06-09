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

  it("round-trips through the serializer", () => {
    const once = parseBuildDoc(DOC);
    const twice = parseBuildDoc(serializeBuildDoc(once));
    expect(twice.targets.map((t) => t.name)).toEqual(once.targets.map((t) => t.name));
    expect(twice.targets[1]!.header.cache).toEqual(once.targets[1]!.header.cache);
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
