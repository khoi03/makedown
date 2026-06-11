import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import { runBuild, renderTarget } from "./build.js";
import { PathEscapeError } from "./paths.js";
import { FakeProvider, makeWorkspace, type Workspace } from "./_testkit.js";

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(() => ws.cleanup());

describe("path-traversal guard wired into the build", () => {
  it("rejects a chat target whose output escapes the workspace", async () => {
    // Nest the workspace in its own parent so the escaping write target is a
    // controlled, otherwise-empty location we can assert on.
    await ws.write("inner/sources/notes.md", "hello");
    const innerCtx = { ...ws.ctx(new FakeProvider()), workspaceDir: join(ws.dir, "inner") };
    const doc = parseBuildDoc(
      `## target: leak
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
model: m
output: ../escaped.md
\`\`\`
Summarize {{sources/notes.md}}.
`,
    );
    await expect(runBuild(doc, innerCtx)).rejects.toThrow(PathEscapeError);
    // The escaping file must not have been written into the workspace's parent.
    await expect(access(join(ws.dir, "escaped.md"))).rejects.toThrow();
  });

  it("rejects a source input that escapes the workspace", async () => {
    const doc = parseBuildDoc(
      `## target: leak
\`\`\`yaml
inputs: [../../secret.md]
step: chat
model: m
output: artifacts/leak.md
\`\`\`
Read {{../../secret.md}}.
`,
    );
    await expect(runBuild(doc, ws.ctx(new FakeProvider()))).rejects.toThrow(PathEscapeError);
  });

  it("rejects a transform script path that escapes the workspace", async () => {
    await ws.write("sources/notes.md", "hello");
    const doc = parseBuildDoc(
      `## target: leak
\`\`\`yaml
inputs: [sources/notes.md]
step: transform
transform: ../evil.mjs
output: artifacts/leak.md
\`\`\`
`,
    );
    await expect(runBuild(doc, ws.ctx())).rejects.toThrow(PathEscapeError);
  });

  it("rejects an absolute output path", async () => {
    await ws.write("sources/notes.md", "hello");
    const doc = parseBuildDoc(
      `## target: leak
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
model: m
output: /tmp/escaped.md
\`\`\`
Summarize {{sources/notes.md}}.
`,
    );
    await expect(runBuild(doc, ws.ctx(new FakeProvider()))).rejects.toThrow(PathEscapeError);
  });

  it("the guard also fires during md render (prompt interpolation)", async () => {
    const doc = parseBuildDoc(
      `## target: leak
\`\`\`yaml
inputs: [../../secret.md]
step: chat
model: m
output: artifacts/leak.md
\`\`\`
Read {{../../secret.md}}.
`,
    );
    await expect(renderTarget(doc, "leak", ws.ctx())).rejects.toThrow(PathEscapeError);
  });

  it("still builds normally for in-workspace paths", async () => {
    await ws.write("sources/notes.md", "hello");
    const doc = parseBuildDoc(
      `## target: ok
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
model: m
output: artifacts/ok.md
\`\`\`
Summarize {{sources/notes.md}}.
`,
    );
    const result = await runBuild(doc, ws.ctx(new FakeProvider()));
    expect(result.built).toEqual(["ok"]);
    await access(join(ws.dir, "artifacts", "ok.md")); // written inside, no throw
  });
});
