import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseBuildDoc } from "@makedown/format";
import { estimateBuildCost, estimateTokens } from "./cost.js";
import { FakeProvider, makeWorkspace, type Workspace } from "./_testkit.js";

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
  await ws.write("sources/notes.md", "x".repeat(400)); // ~100 tokens
});

afterEach(() => ws.cleanup());

describe("estimateTokens", () => {
  it("approximates ~4 characters per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("estimateBuildCost", () => {
  it("estimates input tokens and an upper-bound cost for a chat target", async () => {
    const doc = parseBuildDoc(
      `## target: summary
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
model: claude-opus-4-8
params: { max_tokens: 1000 }
\`\`\`
Summarize {{sources/notes.md}}.
`,
    );
    const est = await estimateBuildCost(doc, ws.ctx());
    const t = est.targets.find((x) => x.target === "summary")!;

    expect(t.calls).toBe(1);
    expect(t.inputTokens).toBeGreaterThan(90);
    expect(t.maxOutputTokens).toBe(1000);
    // claude-opus-4-8: $5/1M in, $25/1M out.
    const expected = (t.inputTokens * 5 + 1000 * 25) / 1_000_000;
    expect(t.costUsd).toBeCloseTo(expected, 10);
    expect(est.totalCostUsd).toBeCloseTo(expected, 10);
    expect(est.hasUnpriced).toBe(false);
  });

  it("reports zero cost for a transform target", async () => {
    await ws.write("t.mjs", "export default () => 'x';");
    const doc = parseBuildDoc(
      `## target: gen
\`\`\`yaml
inputs: [sources/notes.md]
step: transform
transform: t.mjs
\`\`\`
`,
    );
    const est = await estimateBuildCost(doc, ws.ctx());
    const t = est.targets.find((x) => x.target === "gen")!;
    expect(t.calls).toBe(0);
    expect(t.costUsd).toBe(0);
    expect(est.totalCostUsd).toBe(0);
  });

  it("multiplies a map target's cost by the item count", async () => {
    await ws.write("sources/list.json", `["a", "b", "c"]`);
    const doc = parseBuildDoc(
      `## target: titles
\`\`\`yaml
inputs: [sources/list.json]
step: map
over: sources/list.json
model: claude-opus-4-8
params: { max_tokens: 100 }
\`\`\`
Title for {{item}}.
`,
    );
    const est = await estimateBuildCost(doc, ws.ctx());
    const t = est.targets.find((x) => x.target === "titles")!;
    expect(t.calls).toBe(3);
    expect(t.maxOutputTokens).toBe(300); // 3 * 100
  });

  it("marks an unknown model as unpriced", async () => {
    const doc = parseBuildDoc(
      `## target: t
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
model: openai:some-unknown-model
\`\`\`
Use {{sources/notes.md}}.
`,
    );
    const est = await estimateBuildCost(doc, ws.ctx());
    const t = est.targets.find((x) => x.target === "t")!;
    expect(t.costUsd).toBeUndefined();
    expect(est.hasUnpriced).toBe(true);
  });

  it("excludes fresh (cached) targets from the total", async () => {
    const doc = parseBuildDoc(
      `## target: summary
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
model: claude-opus-4-8
\`\`\`
Summarize {{sources/notes.md}}.
`,
    );
    await runBuildOnce(doc);
    const est = await estimateBuildCost(doc, ws.ctx());
    const t = est.targets.find((x) => x.target === "summary")!;
    expect(t.stale).toBe(false);
    expect(est.totalCostUsd).toBe(0); // nothing stale to spend on
  });

  async function runBuildOnce(doc: ReturnType<typeof parseBuildDoc>): Promise<void> {
    const { runBuild } = await import("./build.js");
    await runBuild(doc, ws.ctx(new FakeProvider()));
  }
});
