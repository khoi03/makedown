import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import { LocalCas } from "@makedown/engine";
import type { CompletionRequest, CompletionResult, Provider } from "@makedown/providers";
import { runBuild } from "@makedown/engine";
import { getGraph, getArtifact, getProvenance, getCost } from "./artifacts.js";

class FakeProvider implements Provider {
  readonly id = "fake";
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: `SUMMARY of ${req.prompt.length} chars`, usage: { input: 5, output: 7 }, costUsd: 0.02 };
  }
}

const DOC = `
## target: summary
\`\`\`yaml
inputs: [sources/a.md]
step: chat
model: fake
output: artifacts/summary.md
cache: deterministic
\`\`\`
Summarize {{sources/a.md}}.

## target: report
\`\`\`yaml
inputs: [summary]
step: chat
model: fake
output: artifacts/report.md
cache: deterministic
\`\`\`
Expand {{summary}}.
`;

describe("artifacts service", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdart-"));
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources/a.md"), "raw notes", "utf8");
    await writeFile(join(dir, "build.md"), DOC, "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the graph with stale flags, deps, step, and order", async () => {
    const graph = await getGraph(dir);
    expect(graph.order).toEqual(["summary", "report"]);
    const report = graph.targets.find((t) => t.name === "report");
    expect(report?.deps).toEqual(["summary"]);
    expect(report?.step).toBe("chat");
    expect(report?.stale).toBe(true); // nothing built yet
  });

  it("returns undefined for an artifact that has not been built", async () => {
    expect(await getArtifact(dir, "summary")).toBeUndefined();
  });

  it("returns artifact content + provenance after a build", async () => {
    const doc = parseBuildDoc(DOC);
    await runBuild(doc, { workspaceDir: dir, cas: new LocalCas(join(dir, ".makedown")), provider: new FakeProvider() });

    const art = await getArtifact(dir, "summary");
    expect(art?.content).toContain("SUMMARY");
    expect(art?.provenance.target).toBe("summary");
    expect(art?.provenance.step).toBe("chat");

    const prov = await getProvenance(dir, "summary");
    expect(prov?.tokens).toEqual({ input: 5, output: 7 });
  });

  it("marks built targets fresh in the graph after a build", async () => {
    const doc = parseBuildDoc(DOC);
    await runBuild(doc, { workspaceDir: dir, cas: new LocalCas(join(dir, ".makedown")), provider: new FakeProvider() });
    const graph = await getGraph(dir);
    expect(graph.targets.every((t) => !t.stale)).toBe(true);
  });

  it("estimates build cost over stale model targets", async () => {
    const cost = await getCost(dir);
    expect(cost.targets).toHaveLength(2);
    expect(cost.totalCostUsd).toBeGreaterThanOrEqual(0);
  });

  it("throws on an unknown target artifact request", async () => {
    await expect(getArtifact(dir, "does-not-exist")).rejects.toThrow();
  });
});
