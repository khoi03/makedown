import { afterEach, describe, expect, it } from "vitest";
import { parseBuildDoc } from "@makedown/format";
import { runBuild, type BuildEvent } from "./build.js";
import { makeWorkspace, FakeProvider, type Workspace } from "./_testkit.js";

/**
 * The server streams build progress to the web UI, so the engine must emit
 * per-target lifecycle events through the optional `onProgress` hook. These
 * tests pin the event contract: order, payload, and the reused/denied paths.
 */
describe("BuildContext.onProgress", () => {
  let ws: Workspace;

  afterEach(async () => {
    await ws?.cleanup();
  });

  it("emits start then built for each stale target, in dependency order", async () => {
    ws = await makeWorkspace();
    await ws.write("sources/a.md", "alpha");
    const doc = parseBuildDoc(`
## target: one
\`\`\`yaml
inputs: [sources/a.md]
step: chat
model: fake
output: artifacts/one.md
cache: always
\`\`\`
Summarize {{sources/a.md}}.

## target: two
\`\`\`yaml
inputs: [one]
step: chat
model: fake
output: artifacts/two.md
cache: always
\`\`\`
Expand on {{one}}.
`);
    const events: BuildEvent[] = [];
    await runBuild(doc, ws.ctx(new FakeProvider(), { onProgress: (e) => events.push(e) }));

    expect(events).toEqual([
      { type: "target-start", target: "one", stale: true },
      { type: "target-built", target: "one" },
      { type: "target-start", target: "two", stale: true },
      { type: "target-built", target: "two" },
    ]);
  });

  it("emits target-reused when a target is cached, not target-built", async () => {
    ws = await makeWorkspace();
    await ws.write("sources/a.md", "alpha");
    const text = `
## target: one
\`\`\`yaml
inputs: [sources/a.md]
step: chat
model: fake
output: artifacts/one.md
cache: deterministic
\`\`\`
Summarize {{sources/a.md}}.
`;
    const doc = parseBuildDoc(text);
    // First build populates the cache.
    await runBuild(doc, ws.ctx(new FakeProvider()));

    const events: BuildEvent[] = [];
    await runBuild(doc, ws.ctx(new FakeProvider(), { onProgress: (e) => events.push(e) }));

    expect(events).toEqual([
      { type: "target-start", target: "one", stale: false },
      { type: "target-reused", target: "one" },
    ]);
  });

  it("emits target-denied then target-skipped for a denied gate and its dependents", async () => {
    ws = await makeWorkspace();
    await ws.write("sources/spec.md", "do the thing");
    const doc = parseBuildDoc(`
## target: change
\`\`\`yaml
inputs: [sources/spec.md]
step: agent
agent: fake-agent
sandbox: none
approval: required
output: artifacts/change.diff
cache: always
\`\`\`
Implement {{sources/spec.md}}.

## target: report
\`\`\`yaml
inputs: [change]
step: chat
model: fake
output: artifacts/report.md
cache: always
\`\`\`
Describe {{change}}.
`);
    const events: BuildEvent[] = [];
    const { FakeAgentRunner } = await import("./_testkit.js");
    await runBuild(
      doc,
      ws.ctx(new FakeProvider(), {
        agentRunner: new FakeAgentRunner(),
        approve: async () => false, // deny the gate
        onProgress: (e) => events.push(e),
      }),
    );

    expect(events).toEqual([
      { type: "target-start", target: "change", stale: true },
      { type: "target-denied", target: "change" },
      { type: "target-skipped", target: "report" },
    ]);
  });

  it("does not require an onProgress callback (optional)", async () => {
    ws = await makeWorkspace();
    await ws.write("sources/a.md", "alpha");
    const doc = parseBuildDoc(`
## target: one
\`\`\`yaml
inputs: [sources/a.md]
step: chat
model: fake
output: artifacts/one.md
cache: always
\`\`\`
Summarize {{sources/a.md}}.
`);
    // No onProgress — must not throw.
    const result = await runBuild(doc, ws.ctx(new FakeProvider()));
    expect(result.built).toEqual(["one"]);
  });
});
