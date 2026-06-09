import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import { LocalCas } from "./cas.js";
import { planBuild, runBuild } from "./build.js";
import { FakeProvider, makeWorkspace, type Workspace } from "./_testkit.js";

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(() => ws.cleanup());

const MAP_DOC = `## target: titles
\`\`\`yaml
inputs: [sources/list.json]
step: map
over: sources/list.json
model: claude-opus-4-8
output: artifacts/titles.json
\`\`\`
Title for {{item}}.
`;

describe("map step", () => {
  it("fans out over a JSON array, one call per item, into a JSON-array artifact", async () => {
    await ws.write("sources/list.json", `["alpha", "beta", "gamma"]`);
    const doc = parseBuildDoc(MAP_DOC);
    const provider = new FakeProvider((req) => req.prompt.toUpperCase());

    await runBuild(doc, ws.ctx(provider));

    expect(provider.calls).toHaveLength(3);
    expect(provider.calls.map((c) => c.prompt)).toEqual([
      "Title for alpha.",
      "Title for beta.",
      "Title for gamma.",
    ]);

    const out = JSON.parse(await readFile(join(ws.dir, "artifacts", "titles.json"), "utf8"));
    expect(out).toEqual(["TITLE FOR ALPHA.", "TITLE FOR BETA.", "TITLE FOR GAMMA."]);
  });

  it("fans out over a newline-delimited list", async () => {
    await ws.write("sources/lines.txt", "one\ntwo\n\nthree\n");
    const doc = parseBuildDoc(
      `## target: t
\`\`\`yaml
inputs: [sources/lines.txt]
step: map
over: sources/lines.txt
model: claude-opus-4-8
output: artifacts/t.json
\`\`\`
Echo {{item}}.
`,
    );
    const provider = new FakeProvider((req) => req.prompt);
    await runBuild(doc, ws.ctx(provider));
    // Blank lines are dropped.
    expect(provider.calls.map((c) => c.prompt)).toEqual(["Echo one.", "Echo two.", "Echo three."]);
  });

  it("binds {{item}} while still resolving other declared inputs", async () => {
    await ws.write("sources/list.json", `["x"]`);
    await ws.write("sources/ctx.md", "SHARED");
    const doc = parseBuildDoc(
      `## target: t
\`\`\`yaml
inputs: [sources/list.json, sources/ctx.md]
step: map
over: sources/list.json
model: claude-opus-4-8
output: artifacts/t.json
\`\`\`
{{item}} uses {{sources/ctx.md}}.
`,
    );
    const provider = new FakeProvider((req) => req.prompt);
    await runBuild(doc, ws.ctx(provider));
    expect(provider.calls[0]!.prompt).toBe("x uses SHARED.");
  });

  it("records step=map with summed token usage", async () => {
    await ws.write("sources/list.json", `["a", "b"]`);
    const doc = parseBuildDoc(MAP_DOC);
    await runBuild(doc, ws.ctx(new FakeProvider()));

    const plan = await planBuild(doc, ws.ctx());
    const prov = await new LocalCas(join(ws.dir, ".makedown")).getProvenance(plan.ids.get("titles")!);
    expect(prov?.step).toBe("map");
    expect(prov?.tokens).toEqual({ input: 2, output: 4 }); // 2 items * {in:1,out:2}
  });

  it("handles an empty list with zero provider calls", async () => {
    await ws.write("sources/list.json", `[]`);
    const doc = parseBuildDoc(MAP_DOC);
    const provider = new FakeProvider();
    const result = await runBuild(doc, ws.ctx(provider));

    expect(provider.calls).toHaveLength(0);
    expect(result.built).toEqual(["titles"]);
    const out = JSON.parse(await readFile(join(ws.dir, "artifacts", "titles.json"), "utf8"));
    expect(out).toEqual([]);
  });

  it("rejects step=map without an over field at parse time", () => {
    expect(() =>
      parseBuildDoc(
        `## target: t
\`\`\`yaml
inputs: [sources/list.json]
step: map
model: claude-opus-4-8
\`\`\`
Title for {{item}}.
`,
      ),
    ).toThrow(/over/i);
  });

  it("rejects a map whose over input is not declared in inputs", () => {
    expect(() =>
      parseBuildDoc(
        `## target: t
\`\`\`yaml
inputs: [sources/other.md]
step: map
over: sources/list.json
model: claude-opus-4-8
\`\`\`
Title for {{item}}.
`,
      ),
    ).toThrow(/over/i);
  });
});
