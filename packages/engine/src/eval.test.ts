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
  await ws.write("sources/draft.md", "the draft text");
});

afterEach(() => ws.cleanup());

const EVAL_DOC = `## target: grade
\`\`\`yaml
inputs: [sources/draft.md]
step: eval
model: claude-opus-4-8
output: artifacts/grade.md
\`\`\`
Grade {{sources/draft.md}} from 1-10.
`;

const EVAL_SCHEMA_DOC = `## target: grade
\`\`\`yaml
inputs: [sources/draft.md]
step: eval
model: claude-opus-4-8
schema: { type: object }
output: artifacts/grade.json
\`\`\`
Grade {{sources/draft.md}}. Reply with JSON.
`;

describe("eval step", () => {
  it("runs as a single model call and records step=eval", async () => {
    const doc = parseBuildDoc(EVAL_DOC);
    const provider = new FakeProvider(() => "Score: 7/10");
    await runBuild(doc, ws.ctx(provider));

    expect(provider.calls).toHaveLength(1);
    const out = await readFile(join(ws.dir, "artifacts", "grade.md"), "utf8");
    expect(out).toBe("Score: 7/10");

    const plan = await planBuild(doc, ws.ctx());
    const prov = await new LocalCas(join(ws.dir, ".makedown")).getProvenance(plan.ids.get("grade")!);
    expect(prov?.step).toBe("eval");
  });

  it("accepts valid JSON output when a schema is declared", async () => {
    const doc = parseBuildDoc(EVAL_SCHEMA_DOC);
    const provider = new FakeProvider(() => `{"score": 8, "reason": "clear"}`);
    await runBuild(doc, ws.ctx(provider));

    const out = await readFile(join(ws.dir, "artifacts", "grade.json"), "utf8");
    expect(JSON.parse(out).score).toBe(8);
  });

  it("rejects non-JSON output when a schema is declared", async () => {
    const doc = parseBuildDoc(EVAL_SCHEMA_DOC);
    const provider = new FakeProvider(() => "not json at all");
    await expect(runBuild(doc, ws.ctx(provider))).rejects.toThrow(/valid JSON/i);
  });

  it("does not require JSON when no schema is declared", async () => {
    const doc = parseBuildDoc(EVAL_DOC);
    const provider = new FakeProvider(() => "free-form prose grade");
    const result = await runBuild(doc, ws.ctx(provider));
    expect(result.built).toEqual(["grade"]);
  });
});
