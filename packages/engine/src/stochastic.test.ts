import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import type { CompletionRequest, CompletionResult, Provider } from "@makedown/providers";
import { LocalCas } from "./cas.js";
import { planBuild, runBuild } from "./build.js";
import { makeWorkspace, type Workspace } from "./_testkit.js";

/** A provider that returns a distinct response per call (to model variance). */
class CountingProvider implements Provider {
  readonly id = "counting";
  calls = 0;
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    this.calls += 1;
    return { text: `sample-${this.calls}`, usage: { input: 1, output: 2 }, costUsd: 0.01 };
  }
}

/** A provider that succeeds `okCount` times then throws (simulates interruption). */
class FlakyProvider implements Provider {
  readonly id = "flaky";
  calls = 0;
  constructor(private readonly okCount: number) {}
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    this.calls += 1;
    if (this.calls > this.okCount) throw new Error("provider failed");
    return { text: `sample-${this.calls}`, usage: { input: 1, output: 2 }, costUsd: 0.01 };
  }
}

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
  await ws.write("sources/notes.md", "hello");
});

afterEach(() => ws.cleanup());

const STOCHASTIC_DOC = `## target: ideas
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
model: claude-opus-4-8
cache: stochastic(n=3)
output: artifacts/ideas.md
\`\`\`
Brainstorm from {{sources/notes.md}}.
`;

describe("stochastic(n=k) cache policy", () => {
  it("generates k samples on the first build, then is fresh", async () => {
    const doc = parseBuildDoc(STOCHASTIC_DOC);
    const provider = new CountingProvider();
    const result = await runBuild(doc, ws.ctx(provider));

    expect(provider.calls).toBe(3);
    expect(result.built).toEqual(["ideas"]);

    const plan = await planBuild(doc, ws.ctx());
    expect(plan.targets.find((t) => t.name === "ideas")?.stale).toBe(false);
  });

  it("writes the blessed sample (index 0) to the output path", async () => {
    const doc = parseBuildDoc(STOCHASTIC_DOC);
    await runBuild(doc, ws.ctx(new CountingProvider()));
    const out = await readFile(join(ws.dir, "artifacts", "ideas.md"), "utf8");
    expect(out).toBe("sample-1");
  });

  it("makes zero provider calls on a no-op rebuild", async () => {
    const doc = parseBuildDoc(STOCHASTIC_DOC);
    await runBuild(doc, ws.ctx(new CountingProvider()));

    const provider = new CountingProvider();
    const result = await runBuild(doc, ws.ctx(provider));
    expect(provider.calls).toBe(0);
    expect(result.reused).toEqual(["ideas"]);
  });

  it("tops up only the missing samples after an interrupted build", async () => {
    const doc = parseBuildDoc(STOCHASTIC_DOC);

    // First attempt fails after persisting 2 of 3 samples.
    await expect(runBuild(doc, ws.ctx(new FlakyProvider(2)))).rejects.toThrow();

    const cas = new LocalCas(join(ws.dir, ".makedown"));
    const plan = await planBuild(doc, ws.ctx());
    const id = plan.ids.get("ideas")!;
    expect(await cas.countSamples(id)).toBe(2);

    // Second build only needs the 3rd sample.
    const provider = new CountingProvider();
    await runBuild(doc, ws.ctx(provider));
    expect(provider.calls).toBe(1);
    expect(await cas.countSamples(id)).toBe(3);
  });

  it("lets a downstream target consume the blessed sample", async () => {
    const doc = parseBuildDoc(
      `${STOCHASTIC_DOC}
## target: digest
\`\`\`yaml
inputs: [ideas]
step: chat
model: claude-opus-4-8
output: artifacts/digest.md
\`\`\`
Summarize {{ideas}}.
`,
    );
    const provider = new CountingProvider();
    await runBuild(doc, ws.ctx(provider));
    // The digest prompt must contain the blessed sample's text (sample-1).
    const digestCall = provider.calls; // last call is digest
    expect(digestCall).toBe(4); // 3 samples + 1 digest
  });
});

describe("LocalCas sample storage", () => {
  it("defaults the blessed pointer to 0 and lets it be changed", async () => {
    const cas = new LocalCas(join(ws.dir, ".makedown"));
    const id = "sha256:deadbeef";
    const prov = {
      target: "t",
      id,
      output: "artifacts/t.md",
      step: "chat" as const,
      params: {},
      inputs: [],
      promptHash: "sha256:p",
      producedAt: "2026-06-09T00:00:00.000Z",
    };
    await cas.putSample({ id, index: 0, content: new TextEncoder().encode("zero"), provenance: prov });
    await cas.putSample({ id, index: 1, content: new TextEncoder().encode("one"), provenance: prov });

    expect(await cas.countSamples(id)).toBe(2);
    expect(await cas.getBlessed(id)).toBe(0);

    await cas.setBlessed(id, 1);
    expect(await cas.getBlessed(id)).toBe(1);
    expect(new TextDecoder().decode(await cas.getSample(id, 1))).toBe("one");
  });
});

describe("cache policy validation", () => {
  it("rejects cache: stochastic on a transform step", () => {
    expect(() =>
      parseBuildDoc(
        `## target: t
\`\`\`yaml
inputs: [sources/notes.md]
step: transform
transform: t.mjs
cache: stochastic(n=2)
\`\`\`
`,
      ),
    ).toThrow(/stochastic/i);
  });

  it("rejects stochastic(n=0)", () => {
    expect(() =>
      parseBuildDoc(
        `## target: t
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
model: claude-opus-4-8
cache: stochastic(n=0)
\`\`\`
hi
`,
      ),
    ).toThrow(/stochastic/i);
  });
});
