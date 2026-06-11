import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { LocalCas, type BuildContext } from "@makedown/engine";
import type { CompletionRequest, CompletionResult, Provider } from "@makedown/providers";
import { WorkspaceStore, type ServerContextHooks } from "./workspace.js";
import { BuildManager } from "./builds.js";
import { buildApi } from "./api.js";

const exec = promisify(execFile);

class FakeProvider implements Provider {
  readonly id = "fake";
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: `OUT(${req.prompt.slice(0, 6)})`, usage: { input: 1, output: 2 }, costUsd: 0.01 };
  }
}

const DOC = `
## target: summary
\`\`\`yaml
inputs: [sources/a.md]
step: chat
model: fake
output: artifacts/summary.md
cache: deterministic
\`\`\`
Summarize {{sources/a.md}}.
`;

describe("buildApi", () => {
  let root: string;
  let app: FastifyInstance;
  let manager: BuildManager;

  async function makeWorkspace(id: string, doc = DOC): Promise<string> {
    const dir = join(root, id);
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources/a.md"), "raw notes", "utf8");
    await writeFile(join(dir, "build.md"), doc, "utf8");
    await exec("git", ["init", "-b", "main"], { cwd: dir });
    await exec("git", ["config", "user.email", "t@t.dev"], { cwd: dir });
    await exec("git", ["config", "user.name", "T"], { cwd: dir });
    return dir;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdapi-"));
    manager = new BuildManager();
    app = buildApi({
      store: new WorkspaceStore(root),
      manager,
      contextFactory: (dir: string, hooks: ServerContextHooks): BuildContext => ({
        workspaceDir: dir,
        cas: new LocalCas(join(dir, ".makedown")),
        provider: new FakeProvider(),
        onProgress: hooks.onProgress,
        approve: hooks.approve,
      }),
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("GET /api/health -> ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /api/workspaces lists workspaces with a build.md", async () => {
    await makeWorkspace("alpha");
    const res = await app.inject({ method: "GET", url: "/api/workspaces" });
    expect(res.statusCode).toBe(200);
    expect(res.json().workspaces).toContain("alpha");
  });

  it("GET graph returns 404 for unknown and 400 for invalid id", async () => {
    expect((await app.inject({ method: "GET", url: "/api/workspaces/ghost/graph" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/workspaces/..%2Fx/graph" })).statusCode).toBe(400);
  });

  it("GET graph returns the build graph", async () => {
    await makeWorkspace("alpha");
    const res = await app.inject({ method: "GET", url: "/api/workspaces/alpha/graph" });
    expect(res.statusCode).toBe(200);
    expect(res.json().order).toEqual(["summary"]);
    expect(res.json().targets[0]).toMatchObject({ name: "summary", step: "chat", stale: true });
  });

  it("GET cost returns an estimate", async () => {
    await makeWorkspace("alpha");
    const res = await app.inject({ method: "GET", url: "/api/workspaces/alpha/cost" });
    expect(res.statusCode).toBe(200);
    expect(res.json().targets).toHaveLength(1);
  });

  it("POST build runs to completion; artifact + why become available", async () => {
    await makeWorkspace("alpha");
    const start = await app.inject({ method: "POST", url: "/api/workspaces/alpha/build" });
    expect(start.statusCode).toBe(202);
    const jobId = start.json().jobId as string;

    const job = await manager.wait(jobId);
    expect(job.status).toBe("succeeded");

    const status = await app.inject({ method: "GET", url: `/api/builds/${jobId}` });
    expect(status.json().status).toBe("succeeded");

    const art = await app.inject({ method: "GET", url: "/api/workspaces/alpha/artifacts/summary" });
    expect(art.statusCode).toBe(200);
    expect(art.json().content).toContain("OUT(");

    const why = await app.inject({ method: "GET", url: "/api/workspaces/alpha/artifacts/summary/why" });
    expect(why.statusCode).toBe(200);
    expect(why.json().target).toBe("summary");
  });

  it("GET artifact returns 404 before it is built", async () => {
    await makeWorkspace("alpha");
    const res = await app.inject({ method: "GET", url: "/api/workspaces/alpha/artifacts/summary" });
    expect(res.statusCode).toBe(404);
  });

  it("GET build events streams a terminal done event for a finished job", async () => {
    await makeWorkspace("alpha");
    const start = await app.inject({ method: "POST", url: "/api/workspaces/alpha/build" });
    const jobId = start.json().jobId as string;
    await manager.wait(jobId);

    const res = await app.inject({ method: "GET", url: `/api/builds/${jobId}/events` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.payload).toContain('"type":"done"');
  });

  it("POST approval resolves a pending gate (404 for unknown approval)", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/api/builds/nojob/approvals/nope",
      payload: { approved: true },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("creates and lists git snapshots", async () => {
    await makeWorkspace("alpha");
    const created = await app.inject({
      method: "POST",
      url: "/api/workspaces/alpha/snapshots",
      payload: { message: "first" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().sha).toMatch(/^[0-9a-f]{40}$/);

    const list = await app.inject({ method: "GET", url: "/api/workspaces/alpha/snapshots" });
    expect(list.json().snapshots[0].message).toBe("first");
  });

  it("rejects an unsafe branch name with 400", async () => {
    await makeWorkspace("alpha");
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/alpha/branches",
      payload: { name: "-f", create: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists branches and creates/switches a branch", async () => {
    await makeWorkspace("alpha");
    await app.inject({ method: "POST", url: "/api/workspaces/alpha/snapshots", payload: { message: "init" } });

    const created = await app.inject({
      method: "POST",
      url: "/api/workspaces/alpha/branches",
      payload: { name: "experiment", create: true },
    });
    expect(created.statusCode).toBe(200);

    const branches = await app.inject({ method: "GET", url: "/api/workspaces/alpha/branches" });
    expect(branches.json().current).toBe("experiment");
    expect(branches.json().branches).toEqual(expect.arrayContaining(["main", "experiment"]));
  });
});
