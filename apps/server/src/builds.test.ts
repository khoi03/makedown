import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import { LocalCas, type BuildContext } from "@makedown/engine";
import type { CompletionRequest, CompletionResult, Provider } from "@makedown/providers";
import type { AgentRunner, AgentRunRequest, AgentRunResult } from "@makedown/agents";
import { BuildManager, type BuildStreamEvent } from "./builds.js";

/** Deterministic provider + agent runner — no network, no API keys. */
class FakeProvider implements Provider {
  readonly id = "fake";
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: `OUT(${req.prompt.slice(0, 8)})`, usage: { input: 1, output: 2 }, costUsd: 0.01 };
  }
}
class FakeAgent implements AgentRunner {
  readonly id = "fake-agent";
  async run(_req: AgentRunRequest): Promise<AgentRunResult> {
    return { output: "diff", usage: { input: 1, output: 1 }, costUsd: 0.01, producedBy: "agent:fake" };
  }
}

const CHAT_DOC = `
## target: greeting
\`\`\`yaml
inputs: [sources/a.md]
step: chat
model: fake
output: artifacts/greeting.md
cache: always
\`\`\`
Greet using {{sources/a.md}}.
`;

const APPROVAL_DOC = `
## target: change
\`\`\`yaml
inputs: [sources/a.md]
step: agent
agent: fake-agent
sandbox: none
approval: required
output: artifacts/change.diff
cache: always
\`\`\`
Implement {{sources/a.md}}.
`;

describe("BuildManager", () => {
  let dir: string;
  let manager: BuildManager;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdserver-"));
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources/a.md"), "world", "utf8");
    manager = new BuildManager();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function contextFactory(hooks: {
    onProgress: BuildContext["onProgress"];
    approve: BuildContext["approve"];
  }): BuildContext {
    return {
      workspaceDir: dir,
      cas: new LocalCas(join(dir, ".makedown")),
      provider: new FakeProvider(),
      agentRunner: new FakeAgent(),
      onProgress: hooks.onProgress,
      approve: hooks.approve,
    };
  }

  it("runs a build to completion and records the result", async () => {
    const job = manager.start({ workspaceId: "w1", doc: parseBuildDoc(CHAT_DOC), makeContext: contextFactory });
    expect(job.status).toBe("running");

    const finished = await manager.wait(job.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.result?.built).toEqual(["greeting"]);
  });

  it("streams progress events and a terminal done event to a subscriber", async () => {
    const events: BuildStreamEvent[] = [];
    const job = manager.start({ workspaceId: "w1", doc: parseBuildDoc(CHAT_DOC), makeContext: contextFactory });
    manager.subscribe(job.id, (e) => events.push(e));

    await manager.wait(job.id);

    const types = events.map((e) => e.type);
    expect(types).toContain("progress");
    expect(types[types.length - 1]).toBe("done");
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", built: ["greeting"] });
  });

  it("replays history to a late subscriber", async () => {
    const job = manager.start({ workspaceId: "w1", doc: parseBuildDoc(CHAT_DOC), makeContext: contextFactory });
    await manager.wait(job.id);

    const replayed: BuildStreamEvent[] = [];
    manager.subscribe(job.id, (e) => replayed.push(e)); // subscribe AFTER completion
    expect(replayed.map((e) => e.type)).toContain("done");
  });

  it("emits approval-pending and proceeds when the gate is approved", async () => {
    const events: BuildStreamEvent[] = [];
    const job = manager.start({ workspaceId: "w1", doc: parseBuildDoc(APPROVAL_DOC), makeContext: contextFactory });
    manager.subscribe(job.id, (e) => {
      events.push(e);
      if (e.type === "approval-pending") manager.resolveApproval(e.approval.id, true);
    });

    const finished = await manager.wait(job.id);
    expect(events.some((e) => e.type === "approval-pending")).toBe(true);
    expect(finished.result?.built).toEqual(["change"]);
  });

  it("denies the gate when resolved false, marking the target rejected", async () => {
    const job = manager.start({ workspaceId: "w1", doc: parseBuildDoc(APPROVAL_DOC), makeContext: contextFactory });
    manager.subscribe(job.id, (e) => {
      if (e.type === "approval-pending") manager.resolveApproval(e.approval.id, false);
    });

    const finished = await manager.wait(job.id);
    expect(finished.result?.rejected).toContain("change");
    expect(finished.result?.built ?? []).not.toContain("change");
  });

  it("lists pending approvals and clears them once resolved", async () => {
    const job = manager.start({ workspaceId: "w1", doc: parseBuildDoc(APPROVAL_DOC), makeContext: contextFactory });

    // wait until an approval shows up
    await new Promise<void>((resolve) => {
      const unsub = manager.subscribe(job.id, (e) => {
        if (e.type === "approval-pending") {
          unsub();
          resolve();
        }
      });
    });
    expect(manager.pendingApprovals(job.id)).toHaveLength(1);
    const approvalId = manager.pendingApprovals(job.id)[0]!.id;
    expect(manager.resolveApproval(approvalId, true)).toBe(true);
    expect(manager.pendingApprovals(job.id)).toHaveLength(0);
    await manager.wait(job.id);
  });

  it("marks a job failed and emits an error event when the build throws", async () => {
    const events: BuildStreamEvent[] = [];
    const job = manager.start({
      workspaceId: "w1",
      doc: parseBuildDoc(CHAT_DOC),
      makeContext: () => {
        throw new Error("boom: bad context");
      },
    });
    manager.subscribe(job.id, (e) => events.push(e));

    const finished = await manager.wait(job.id);
    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("boom");
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("returns undefined for an unknown job and false for an unknown approval", () => {
    expect(manager.get("nope")).toBeUndefined();
    expect(manager.resolveApproval("nope", true)).toBe(false);
  });
});
