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
  await ws.write("sources/notes.md", "hello world");
});

afterEach(() => ws.cleanup());

const UPPER_TRANSFORM = `export default function transform(inputs) {
  return inputs["sources/notes.md"].toUpperCase();
}
`;

const TRANSFORM_DOC = `## target: shout
\`\`\`yaml
inputs: [sources/notes.md]
step: transform
transform: transforms/upper.mjs
output: artifacts/shout.md
\`\`\`
`;

describe("transform step", () => {
  it("runs a deterministic workspace script with zero provider calls", async () => {
    await ws.write("transforms/upper.mjs", UPPER_TRANSFORM);
    const doc = parseBuildDoc(TRANSFORM_DOC);

    const provider = new FakeProvider();
    const result = await runBuild(doc, ws.ctx(provider));

    expect(result.built).toEqual(["shout"]);
    expect(provider.calls).toHaveLength(0); // zero tokens — "code where code is enough"

    const out = await readFile(join(ws.dir, "artifacts", "shout.md"), "utf8");
    expect(out).toBe("HELLO WORLD");
  });

  it("runs without any provider configured", async () => {
    await ws.write("transforms/upper.mjs", UPPER_TRANSFORM);
    const doc = parseBuildDoc(TRANSFORM_DOC);

    const result = await runBuild(doc, ws.ctx(undefined));
    expect(result.built).toEqual(["shout"]);
  });

  it("records provenance with step=transform and no token usage", async () => {
    await ws.write("transforms/upper.mjs", UPPER_TRANSFORM);
    const doc = parseBuildDoc(TRANSFORM_DOC);
    await runBuild(doc, ws.ctx());

    const plan = await planBuild(doc, ws.ctx());
    const id = plan.ids.get("shout")!;
    const prov = await new LocalCas(join(ws.dir, ".makedown")).getProvenance(id);

    expect(prov?.step).toBe("transform");
    expect(prov?.tokens).toBeUndefined();
    expect(prov?.costUsd).toBe(0);
  });

  it("re-stales the target when the transform script content changes", async () => {
    await ws.write("transforms/upper.mjs", UPPER_TRANSFORM);
    const doc = parseBuildDoc(TRANSFORM_DOC);
    await runBuild(doc, ws.ctx());

    // No-op rebuild reuses.
    const reuse = await runBuild(doc, ws.ctx());
    expect(reuse.reused).toEqual(["shout"]);

    // Changing the script body must invalidate the cache.
    await ws.write(
      "transforms/upper.mjs",
      `export default function transform(inputs) { return inputs["sources/notes.md"].trim(); }`,
    );
    const plan = await planBuild(doc, ws.ctx());
    expect(plan.targets.find((t) => t.name === "shout")?.stale).toBe(true);
  });

  it("supports a named `transform` export and feeds dependency artifacts as inputs", async () => {
    await ws.write(
      "transforms/join.mjs",
      `export function transform(inputs) {
        return Object.entries(inputs).map(([k, v]) => k + "=" + v).join("\\n");
      }`,
    );
    const doc = parseBuildDoc(
      `## target: base
\`\`\`yaml
inputs: [sources/notes.md]
step: transform
transform: transforms/join.mjs
output: artifacts/base.md
\`\`\`
`,
    );
    await runBuild(doc, ws.ctx());
    const out = await readFile(join(ws.dir, "artifacts", "base.md"), "utf8");
    expect(out).toBe("sources/notes.md=hello world");
  });

  it("throws a clear error when the script does not export a function", async () => {
    await ws.write("transforms/bad.mjs", `export const notAFunction = 42;`);
    const doc = parseBuildDoc(
      `## target: oops
\`\`\`yaml
inputs: [sources/notes.md]
step: transform
transform: transforms/bad.mjs
output: artifacts/oops.md
\`\`\`
`,
    );
    await expect(runBuild(doc, ws.ctx())).rejects.toThrow(/must export a function/i);
  });

  it("rejects step=transform that omits the transform field at parse time", () => {
    expect(() =>
      parseBuildDoc(
        `## target: nofn
\`\`\`yaml
inputs: [sources/notes.md]
step: transform
output: artifacts/nofn.md
\`\`\`
`,
      ),
    ).toThrow(/transform/i);
  });
});
