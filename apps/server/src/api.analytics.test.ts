import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { LocalCas, type BuildContext } from "@makedown/engine";
import type { CompletionRequest, CompletionResult, Provider } from "@makedown/providers";
import { WorkspaceStore, type ServerContextHooks } from "./workspace.js";
import { BuildManager } from "./builds.js";
import { buildApi } from "./api.js";
import { TenancyService, InMemoryTenancyStore } from "./tenancy/index.js";

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

function sessionCookie(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0]! : String(raw);
  return header.split(";")[0]!;
}

function fakeContext(dir: string, hooks: ServerContextHooks): BuildContext {
  return {
    workspaceDir: dir,
    cas: new LocalCas(join(dir, ".makedown")),
    provider: new FakeProvider(),
    onProgress: hooks.onProgress,
    approve: hooks.approve,
  };
}

async function makeWorkspace(root: string, id: string): Promise<void> {
  const dir = join(root, id);
  await mkdir(join(dir, "sources"), { recursive: true });
  await writeFile(join(dir, "sources/a.md"), "raw notes", "utf8");
  await writeFile(join(dir, "build.md"), DOC, "utf8");
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "t@t.dev"], { cwd: dir });
  await exec("git", ["config", "user.name", "T"], { cwd: dir });
}

describe("analytics read-API (tenancy enabled)", () => {
  let root: string;
  let app: FastifyInstance;
  let manager: BuildManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdanalytics-"));
    manager = new BuildManager();
    app = buildApi({
      store: new WorkspaceStore(root),
      manager,
      tenancy: new TenancyService(new InMemoryTenancyStore()),
      contextFactory: fakeContext,
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  /** Sign up an owner, register the workspace, build it (dual-writing provenance). */
  async function setupOrgWithBuild(): Promise<{ cookie: string; orgId: string }> {
    await makeWorkspace(root, "proj");
    const owner = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "owner@example.com", password: "owner-password" },
    });
    const cookie = sessionCookie(owner);
    const orgId = owner.json().org.id;
    await app.inject({
      method: "POST",
      url: `/api/orgs/${orgId}/workspaces`,
      headers: { cookie },
      payload: { workspaceId: "proj" },
    });
    const build = await app.inject({ method: "POST", url: "/api/workspaces/proj/build", headers: { cookie } });
    await manager.wait(build.json().jobId);
    return { cookie, orgId };
  }

  it("returns org-scoped analytics for a member", async () => {
    const { cookie, orgId } = await setupOrgWithBuild();
    const res = await app.inject({ method: "GET", url: `/api/orgs/${orgId}/analytics`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.summary.orgId).toBe(orgId);
    expect(body.summary.totals.runs).toBe(1);
    expect(body.summary.byWorkspace[0].key).toBe("proj");
  });

  it("rejects a non-member with 403", async () => {
    const { orgId } = await setupOrgWithBuild();
    const outsider = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "outsider@example.com", password: "outsider-pass-1" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/orgs/${orgId}/analytics`,
      headers: { cookie: sessionCookie(outsider) },
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires authentication", async () => {
    const { orgId } = await setupOrgWithBuild();
    const res = await app.inject({ method: "GET", url: `/api/orgs/${orgId}/analytics` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid date filter with 400", async () => {
    const { cookie, orgId } = await setupOrgWithBuild();
    const res = await app.inject({
      method: "GET",
      url: `/api/orgs/${orgId}/analytics?from=not-a-date`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("honors a from-date filter", async () => {
    const { cookie, orgId } = await setupOrgWithBuild();
    // A from-date far in the future excludes the just-built artifact.
    const res = await app.inject({
      method: "GET",
      url: `/api/orgs/${orgId}/analytics?from=2099-01-01`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.totals.runs).toBe(0);
  });
});

describe("analytics read-API rate limiting", () => {
  let root: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdanalytics-rl-"));
    app = buildApi({
      store: new WorkspaceStore(root),
      manager: new BuildManager(),
      tenancy: new TenancyService(new InMemoryTenancyStore()),
      contextFactory: fakeContext,
      analyticsRateLimit: { max: 1, windowMs: 60_000 },
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("returns 429 once the per-IP analytics request limit is exceeded", async () => {
    const owner = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "owner@example.com", password: "owner-password" },
    });
    const cookie = sessionCookie(owner);
    const orgId = owner.json().org.id;

    const first = await app.inject({ method: "GET", url: `/api/orgs/${orgId}/analytics`, headers: { cookie } });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: "GET", url: `/api/orgs/${orgId}/analytics`, headers: { cookie } });
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
  });
});

describe("analytics read-API (single-tenant)", () => {
  let root: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdanalytics-st-"));
    app = buildApi({ store: new WorkspaceStore(root), manager: new BuildManager(), contextFactory: fakeContext });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("reports analytics as unavailable (graceful empty state, no auth wall)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/orgs/any/analytics" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
  });
});
