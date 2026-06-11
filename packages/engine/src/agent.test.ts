import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import { LocalCas } from "./cas.js";
import { planBuild, runBuild } from "./build.js";
import { FakeProvider, FakeAgentRunner, makeWorkspace, type Workspace } from "./_testkit.js";

const run = promisify(execFile);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function initGitRepo(dir: string): Promise<void> {
  await run("git", ["-C", dir, "init", "-q"]);
  await run("git", ["-C", dir, "config", "user.email", "test@makedown.dev"]);
  await run("git", ["-C", dir, "config", "user.name", "Makedown Test"]);
  await run("git", ["-C", dir, "add", "."]);
  await run("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
}

const AGENT_DOC = `## target: refactor
\`\`\`yaml
inputs: [sources/spec.md]
step: agent
agent: claude-code
model: claude-opus-4-8
sandbox: none
approval: none
\`\`\`
Implement the change described in {{sources/spec.md}} and emit a unified diff.
`;

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
  await ws.write("sources/spec.md", "Add a hello() function.");
});

afterEach(() => ws.cleanup());

describe("agent step", () => {
  it("runs the agent via the injected runner and writes the artifact", async () => {
    const doc = parseBuildDoc(AGENT_DOC);
    const runner = new FakeAgentRunner();

    const result = await runBuild(doc, ws.ctx(undefined, { agentRunner: runner }));

    expect(result.built).toEqual(["refactor"]);
    expect(result.rejected).toEqual([]);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.prompt).toContain("Add a hello() function.");
    expect(runner.calls[0]!.agent).toBe("claude-code");

    const out = await readFile(join(ws.dir, "artifacts", "refactor.md"), "utf8");
    expect(out).toContain("AGENT(");
  });

  it("records provenance with step=agent, runner usage, and producedBy", async () => {
    const doc = parseBuildDoc(AGENT_DOC);
    await runBuild(doc, ws.ctx(undefined, { agentRunner: new FakeAgentRunner() }));

    const plan = await planBuild(doc, ws.ctx());
    const id = plan.ids.get("refactor")!;
    const prov = await new LocalCas(join(ws.dir, ".makedown")).getProvenance(id);

    expect(prov?.step).toBe("agent");
    expect(prov?.model).toBe("claude-opus-4-8");
    expect(prov?.tokens).toEqual({ input: 3, output: 4 });
    expect(prov?.costUsd).toBe(0.02);
    expect(prov?.producedBy).toBe("agent:claude-code");
  });

  it("throws a clear error when no agent runner is configured", async () => {
    const doc = parseBuildDoc(AGENT_DOC);
    await expect(runBuild(doc, ws.ctx())).rejects.toThrow(/no agent runner/i);
  });

  it("agent steps default to cache: always — they rerun on every build", async () => {
    const doc = parseBuildDoc(AGENT_DOC);
    const runner = new FakeAgentRunner();

    await runBuild(doc, ws.ctx(undefined, { agentRunner: runner }));
    await runBuild(doc, ws.ctx(undefined, { agentRunner: runner }));

    expect(runner.calls).toHaveLength(2); // never reused
  });

  describe("approval gate", () => {
    const GATED_DOC = `## target: refactor
\`\`\`yaml
inputs: [sources/spec.md]
step: agent
agent: claude-code
sandbox: none
approval: required
\`\`\`
Implement {{sources/spec.md}}.
`;

    it("accepts the artifact when the approver returns true", async () => {
      const doc = parseBuildDoc(GATED_DOC);
      const result = await runBuild(
        doc,
        ws.ctx(undefined, { agentRunner: new FakeAgentRunner(), approve: async () => true }),
      );

      expect(result.built).toEqual(["refactor"]);
      expect(result.rejected).toEqual([]);
      expect(await exists(join(ws.dir, "artifacts", "refactor.md"))).toBe(true);
    });

    it("rejects the artifact (no output written) when the approver returns false", async () => {
      const doc = parseBuildDoc(GATED_DOC);
      const runner = new FakeAgentRunner();
      const result = await runBuild(
        doc,
        ws.ctx(undefined, { agentRunner: runner, approve: async () => false }),
      );

      expect(result.built).toEqual([]);
      expect(result.rejected).toEqual(["refactor"]);
      expect(runner.calls).toHaveLength(1); // the agent still ran
      expect(await exists(join(ws.dir, "artifacts", "refactor.md"))).toBe(false);

      const plan = await planBuild(doc, ws.ctx());
      const id = plan.ids.get("refactor")!;
      expect(await new LocalCas(join(ws.dir, ".makedown")).has(id)).toBe(false);
    });

    it("defaults to deny when approval is required but no approver is wired", async () => {
      const doc = parseBuildDoc(GATED_DOC);
      const result = await runBuild(doc, ws.ctx(undefined, { agentRunner: new FakeAgentRunner() }));
      expect(result.rejected).toEqual(["refactor"]);
      expect(await exists(join(ws.dir, "artifacts", "refactor.md"))).toBe(false);
    });

    it("skips downstream targets when an upstream agent artifact is denied", async () => {
      const doc = parseBuildDoc(
        `${GATED_DOC}
## target: summary
\`\`\`yaml
inputs: [refactor]
step: chat
model: claude-opus-4-8
\`\`\`
Summarize {{refactor}}.
`,
      );
      const result = await runBuild(
        doc,
        ws.ctx(new FakeProvider(), {
          agentRunner: new FakeAgentRunner(),
          approve: async () => false,
        }),
      );

      expect(result.built).toEqual([]);
      expect(result.rejected).toEqual(["refactor", "summary"]);
      expect(await exists(join(ws.dir, "artifacts", "summary.md"))).toBe(false);
    });
  });

  it("feeds an accepted agent artifact to a downstream model target", async () => {
    const doc = parseBuildDoc(
      `${AGENT_DOC}
## target: summary
\`\`\`yaml
inputs: [refactor]
step: chat
model: claude-opus-4-8
\`\`\`
Summarize {{refactor}}.
`,
    );
    await runBuild(doc, ws.ctx(new FakeProvider(), { agentRunner: new FakeAgentRunner() }));

    const summary = await readFile(join(ws.dir, "artifacts", "summary.md"), "utf8");
    expect(summary).toContain("AGENT("); // the agent's output flowed downstream
  });

  it("runs the agent inside an isolated git worktree (sandbox: worktree)", async () => {
    await initGitRepo(ws.dir);

    const doc = parseBuildDoc(
      `## target: refactor
\`\`\`yaml
inputs: [sources/spec.md]
step: agent
agent: claude-code
sandbox: worktree
approval: none
\`\`\`
Implement {{sources/spec.md}}.
`,
    );

    let sawWorkdir = "";
    const runner = new FakeAgentRunner((req) => {
      sawWorkdir = req.workdir;
      return { output: "DIFF", usage: { input: 1, output: 1 } };
    });

    const result = await runBuild(doc, ws.ctx(undefined, { agentRunner: runner }));

    expect(result.built).toEqual(["refactor"]);
    expect(sawWorkdir).not.toBe(ws.dir);
    expect(sawWorkdir).not.toBe("");
    expect(await exists(sawWorkdir)).toBe(false); // worktree cleaned up
  });

  it("captures the worktree diff (the agent's actual changes) as the artifact", async () => {
    await initGitRepo(ws.dir);

    const doc = parseBuildDoc(
      `## target: refactor
\`\`\`yaml
inputs: [sources/spec.md]
step: agent
agent: claude-code
sandbox: worktree
approval: none
output: artifacts/refactor.diff
\`\`\`
Implement {{sources/spec.md}}.
`,
    );

    const runner = new FakeAgentRunner(async (req) => {
      await writeFile(join(req.workdir, "greet.js"), "function greet(n){ return n; }\n", "utf8");
      return { output: "I created greet.js", usage: { input: 1, output: 1 } };
    });

    await runBuild(doc, ws.ctx(undefined, { agentRunner: runner }));

    const artifact = await readFile(join(ws.dir, "artifacts", "refactor.diff"), "utf8");
    expect(artifact).toContain("greet.js");
    expect(artifact).toContain("+function greet");
    expect(artifact).not.toContain("I created greet.js"); // the diff, not the summary
  });

  it("falls back to the agent's text output when the sandbox has no diff (sandbox: none)", async () => {
    const doc = parseBuildDoc(AGENT_DOC); // sandbox: none
    await runBuild(doc, ws.ctx(undefined, { agentRunner: new FakeAgentRunner() }));
    const artifact = await readFile(join(ws.dir, "artifacts", "refactor.md"), "utf8");
    expect(artifact).toContain("AGENT(");
  });
});
