import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import type { CompletionRequest, CompletionResult, Provider } from "@makedown/providers";
import { LocalCas } from "./cas.js";
import { planBuild, runBuild, type BuildContext } from "./build.js";

class FakeProvider implements Provider {
  readonly id = "fake";
  readonly calls: CompletionRequest[] = [];
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    return { text: `OUT(${req.prompt})`, usage: { input: 1, output: 2 }, costUsd: 0.01 };
  }
}

const DOC = `---
defaults: { model: claude-opus-4-8 }
artifacts_dir: artifacts
---
## target: summary
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
cache: deterministic
\`\`\`
Summary of {{sources/notes.md}}.

## target: checklist
\`\`\`yaml
inputs: [summary]
step: chat
cache: deterministic
\`\`\`
From {{summary}} make a list.
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "makedown-"));
  await mkdir(join(dir, "sources"), { recursive: true });
  await writeFile(join(dir, "sources", "notes.md"), "hello world", "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ctx(provider?: Provider): BuildContext {
  return {
    workspaceDir: dir,
    cas: new LocalCas(join(dir, ".makedown")),
    provider,
    now: () => new Date("2026-06-09T00:00:00.000Z"),
  };
}

describe("runBuild", () => {
  it("builds all stale targets, interpolates source + target refs, and writes outputs", async () => {
    const doc = parseBuildDoc(DOC);
    const provider = new FakeProvider();
    const result = await runBuild(doc, ctx(provider));

    expect(result.built).toEqual(["summary", "checklist"]);
    expect(provider.calls).toHaveLength(2);

    // Source ref interpolated into the summary prompt; artifact written to disk.
    const summary = await readFile(join(dir, "artifacts", "summary.md"), "utf8");
    expect(summary).toBe("OUT(Summary of hello world.)");

    // Target ref ({{summary}}) interpolated the dependency's artifact content.
    expect(provider.calls[1]!.prompt).toBe("From OUT(Summary of hello world.) make a list.");
  });

  it("reuses cached artifacts on a no-op rebuild (zero provider calls)", async () => {
    const doc = parseBuildDoc(DOC);
    await runBuild(doc, ctx(new FakeProvider()));

    const provider = new FakeProvider();
    const result = await runBuild(doc, ctx(provider));

    expect(result.reused).toEqual(["summary", "checklist"]);
    expect(result.built).toEqual([]);
    expect(provider.calls).toHaveLength(0);
  });

  it("re-stales a target and its dependents when a source changes", async () => {
    const doc = parseBuildDoc(DOC);
    await runBuild(doc, ctx(new FakeProvider()));

    await writeFile(join(dir, "sources", "notes.md"), "changed", "utf8");
    const plan = await planBuild(doc, ctx());
    const stale = Object.fromEntries(plan.targets.map((t) => [t.name, t.stale]));

    expect(stale["summary"]).toBe(true);
    expect(stale["checklist"]).toBe(true);
  });

  it("records provenance with model, tokens, and cost", async () => {
    const doc = parseBuildDoc(DOC);
    await runBuild(doc, ctx(new FakeProvider()));

    const plan = await planBuild(doc, ctx());
    const summaryId = plan.ids.get("summary")!;
    const prov = await new LocalCas(join(dir, ".makedown")).getProvenance(summaryId);

    expect(prov?.model).toBe("claude-opus-4-8");
    expect(prov?.tokens).toEqual({ input: 1, output: 2 });
    expect(prov?.costUsd).toBe(0.01);
    expect(prov?.producedAt).toBe("2026-06-09T00:00:00.000Z");
  });

  it("throws NotImplemented for step types other than chat", async () => {
    const doc = parseBuildDoc(
      `## target: t\n\`\`\`yaml\ninputs: []\nstep: agent\nagent: claude-code\ncache: always\n\`\`\`\nbody\n`,
    );
    await expect(runBuild(doc, ctx(new FakeProvider()))).rejects.toThrow(/not implemented/);
  });

  it("errors when no provider is configured for a chat target", async () => {
    const doc = parseBuildDoc(
      `## target: t\n\`\`\`yaml\ninputs: [sources/notes.md]\nstep: chat\nmodel: claude-opus-4-8\ncache: deterministic\n\`\`\`\nUse {{sources/notes.md}}\n`,
    );
    await expect(runBuild(doc, ctx(undefined))).rejects.toThrow(/No provider/);
  });

  it("applies a head(n) body-transform suffix", async () => {
    await writeFile(join(dir, "sources", "lines.md"), "one\ntwo\nthree", "utf8");
    const doc = parseBuildDoc(
      `## target: top\n\`\`\`yaml\ninputs: [sources/lines.md]\nstep: chat\nmodel: claude-opus-4-8\n\`\`\`\nFirst: {{sources/lines.md:head(2)}}\n`,
    );
    const provider = new FakeProvider();
    await runBuild(doc, ctx(provider));

    expect(provider.calls[0]!.prompt).toBe("First: one\ntwo");
  });
});
