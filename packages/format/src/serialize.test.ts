import { describe, it, expect } from "vitest";
import { parseBuildDoc } from "./parse.js";
import { serializeBuildDoc } from "./serialize.js";

describe("serializeBuildDoc", () => {
  it("emits front-matter defaults and round-trips them", () => {
    const doc = parseBuildDoc(
      `---\nversion: "0.1"\ndefaults:\n  model: claude-opus-4-8\n  params: { temperature: 0 }\n  cache: deterministic\nartifacts_dir: out\nsources_dir: src\n---\n\n## target: a\n\`\`\`yaml\ninputs: []\nstep: chat\n\`\`\`\nbody\n`,
    );
    const text = serializeBuildDoc(doc);
    expect(text).toContain("artifacts_dir: out");
    expect(text).toContain("model: claude-opus-4-8");

    const reparsed = parseBuildDoc(text);
    expect(reparsed.frontMatter.artifactsDir).toBe("out");
    expect(reparsed.frontMatter.sourcesDir).toBe("src");
    expect(reparsed.frontMatter.defaults?.cache).toEqual({ kind: "deterministic" });
  });

  it("emits all optional target fields when set", () => {
    const doc = parseBuildDoc(
      `## target: build_pr\n\`\`\`yaml\ninputs: [spec]\nstep: agent\nmodel: claude-opus-4-8\nparams: { max_tokens: 1000 }\noutput: out/pr.diff\ncache: always\nagent: claude-code\nsandbox: container\napproval: required\n\`\`\`\nUse {{spec}}\n\n## target: spec\n\`\`\`yaml\ninputs: []\nstep: chat\n\`\`\`\nthe spec\n`,
    );
    const text = serializeBuildDoc(doc);
    expect(text).toContain("agent: claude-code");
    expect(text).toContain("sandbox: container");
    expect(text).toContain("approval: required");
    expect(text).toContain("cache: always");

    const reparsed = parseBuildDoc(text);
    const pr = reparsed.targets.find((t) => t.name === "build_pr")!;
    expect(pr.header.agent).toBe("claude-code");
    expect(pr.header.sandbox).toBe("container");
    expect(pr.header.approval).toBe("required");
    expect(pr.header.cache).toEqual({ kind: "always" });
  });
});
