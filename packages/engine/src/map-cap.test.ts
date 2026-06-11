import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import { runBuild, DEFAULT_MAP_FANOUT_CAP } from "./build.js";
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

describe("map fan-out cap", () => {
  it("builds normally when the list is within the cap", async () => {
    await ws.write("sources/list.json", `["a", "b", "c"]`);
    const doc = parseBuildDoc(MAP_DOC);
    const provider = new FakeProvider();

    const result = await runBuild(doc, ws.ctx(provider, { maxMapFanout: 5 }));

    expect(result.built).toEqual(["titles"]);
    expect(provider.calls).toHaveLength(3);
  });

  it("builds when the list is exactly at the cap (boundary)", async () => {
    await ws.write("sources/list.json", `["a", "b"]`);
    const doc = parseBuildDoc(MAP_DOC);
    const provider = new FakeProvider();

    await runBuild(doc, ws.ctx(provider, { maxMapFanout: 2 }));
    expect(provider.calls).toHaveLength(2);
  });

  it("rejects a list that exceeds the cap, making zero provider calls", async () => {
    await ws.write("sources/list.json", `["a", "b", "c"]`);
    const doc = parseBuildDoc(MAP_DOC);
    const provider = new FakeProvider();

    await expect(runBuild(doc, ws.ctx(provider, { maxMapFanout: 2 }))).rejects.toThrow(
      /fan.?out|cap|exceeds/i,
    );
    expect(provider.calls).toHaveLength(0); // fail fast — no spend before the cap check
  });

  it("names the target, the item count, and the cap in the error", async () => {
    await ws.write("sources/list.json", `["a", "b", "c", "d"]`);
    const doc = parseBuildDoc(MAP_DOC);

    await expect(runBuild(doc, ws.ctx(new FakeProvider(), { maxMapFanout: 2 }))).rejects.toThrow(
      /titles[\s\S]*4[\s\S]*2|titles.*\b4\b.*\b2\b/,
    );
  });

  it("applies a safe default cap when none is configured", async () => {
    expect(DEFAULT_MAP_FANOUT_CAP).toBeGreaterThan(0);

    const items = Array.from({ length: DEFAULT_MAP_FANOUT_CAP + 1 }, (_, i) => `item-${i}`);
    await ws.write("sources/list.json", JSON.stringify(items));
    const doc = parseBuildDoc(MAP_DOC);
    const provider = new FakeProvider();

    await expect(runBuild(doc, ws.ctx(provider))).rejects.toThrow(/fan.?out|cap|exceeds/i);
    expect(provider.calls).toHaveLength(0);
  });

  it("does not affect an empty list", async () => {
    await ws.write("sources/list.json", `[]`);
    const doc = parseBuildDoc(MAP_DOC);
    const result = await runBuild(doc, ws.ctx(new FakeProvider(), { maxMapFanout: 2 }));
    expect(result.built).toEqual(["titles"]);
    const out = JSON.parse(await readFile(join(ws.dir, "artifacts", "titles.json"), "utf8"));
    expect(out).toEqual([]);
  });
});
