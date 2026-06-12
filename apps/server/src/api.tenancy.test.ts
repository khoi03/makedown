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

/** Pull the session token out of a Set-Cookie response header. */
function sessionCookie(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0]! : String(raw);
  return header.split(";")[0]!; // "md_session=<token>"
}

describe("buildApi with tenancy enabled", () => {
  let root: string;
  let app: FastifyInstance;
  let manager: BuildManager;
  let tenancy: TenancyService;

  async function makeWorkspace(id: string): Promise<void> {
    const dir = join(root, id);
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources/a.md"), "raw notes", "utf8");
    await writeFile(join(dir, "build.md"), DOC, "utf8");
    await exec("git", ["init", "-b", "main"], { cwd: dir });
    await exec("git", ["config", "user.email", "t@t.dev"], { cwd: dir });
    await exec("git", ["config", "user.name", "T"], { cwd: dir });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdten-"));
    manager = new BuildManager();
    tenancy = new TenancyService(new InMemoryTenancyStore());
    app = buildApi({
      store: new WorkspaceStore(root),
      manager,
      tenancy,
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

  it("reports tenancy enabled via the capability probe", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tenancy" });
    expect(res.json()).toEqual({ enabled: true });
  });

  it("requires authentication for workspace routes", async () => {
    await makeWorkspace("alpha");
    const res = await app.inject({ method: "GET", url: "/api/workspaces/alpha/graph" });
    expect(res.statusCode).toBe(401);
  });

  it("signs up, sets a session cookie, and resolves the current user", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "owner@example.com", password: "owner-password" },
    });
    expect(signup.statusCode).toBe(201);
    expect(signup.json().user.email).toBe("owner@example.com");
    const cookie = sessionCookie(signup);
    expect(cookie).toMatch(/^md_session=/);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("owner@example.com");
  });

  it("validates signup input and never reveals whether an email is taken", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "not-an-email", password: "long-enough" },
    });
    expect(bad.statusCode).toBe(400);

    await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "taken@example.com", password: "password-123" },
    });
    const dup = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "taken@example.com", password: "password-123" },
    });
    expect(dup.statusCode).toBe(409);
  });

  it("enforces RBAC: a viewer can read but not build; an owner can build", async () => {
    await makeWorkspace("proj");
    const ownerRes = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "owner2@example.com", password: "owner2-password" },
    });
    const ownerCookie = sessionCookie(ownerRes);
    const orgId = ownerRes.json().org.id;

    // register the on-disk workspace under the owner's org
    const reg = await app.inject({
      method: "POST",
      url: `/api/orgs/${orgId}/workspaces`,
      headers: { cookie: ownerCookie },
      payload: { workspaceId: "proj" },
    });
    expect(reg.statusCode).toBe(201);

    // owner can read and build
    expect(
      (await app.inject({ method: "GET", url: "/api/workspaces/proj/graph", headers: { cookie: ownerCookie } }))
        .statusCode,
    ).toBe(200);

    // add a viewer to the same org
    const viewerRes = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "viewer@example.com", password: "viewer-password" },
    });
    const viewerCookie = sessionCookie(viewerRes);
    await tenancy.addMemberByEmail(orgId, "viewer@example.com", "viewer");

    // viewer reads OK
    expect(
      (await app.inject({ method: "GET", url: "/api/workspaces/proj/graph", headers: { cookie: viewerCookie } }))
        .statusCode,
    ).toBe(200);
    // viewer cannot build
    expect(
      (await app.inject({ method: "POST", url: "/api/workspaces/proj/build", headers: { cookie: viewerCookie } }))
        .statusCode,
    ).toBe(403);
  });

  it("scopes the workspace list to the caller's orgs", async () => {
    await makeWorkspace("mine");
    await makeWorkspace("theirs");
    const a = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "a@example.com", password: "a-password-123" },
    });
    const aCookie = sessionCookie(a);
    await app.inject({
      method: "POST",
      url: `/api/orgs/${a.json().org.id}/workspaces`,
      headers: { cookie: aCookie },
      payload: { workspaceId: "mine" },
    });

    const list = await app.inject({ method: "GET", url: "/api/workspaces", headers: { cookie: aCookie } });
    expect(list.json().workspaces).toEqual(["mine"]);
  });

  it("offers unclaimed on-disk workspaces as available, then removes them once registered", async () => {
    await makeWorkspace("claimme");
    const owner = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "claim@example.com", password: "claim-password" },
    });
    const cookie = sessionCookie(owner);
    const orgId = owner.json().org.id;

    // before registration: claimme is available, and the user's own list is empty
    const before = await app.inject({
      method: "GET",
      url: "/api/workspaces/available",
      headers: { cookie },
    });
    expect(before.json().workspaces).toEqual(["claimme"]);
    expect(
      (await app.inject({ method: "GET", url: "/api/workspaces", headers: { cookie } })).json().workspaces,
    ).toEqual([]);

    // register it
    await app.inject({
      method: "POST",
      url: `/api/orgs/${orgId}/workspaces`,
      headers: { cookie },
      payload: { workspaceId: "claimme" },
    });

    // after: no longer available, now in the user's list
    expect(
      (await app.inject({ method: "GET", url: "/api/workspaces/available", headers: { cookie } })).json()
        .workspaces,
    ).toEqual([]);
    expect(
      (await app.inject({ method: "GET", url: "/api/workspaces", headers: { cookie } })).json().workspaces,
    ).toEqual(["claimme"]);
  });

  it("dual-writes provenance into the index after a build", async () => {
    await makeWorkspace("dw");
    const owner = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "dw@example.com", password: "dw-password-123" },
    });
    const cookie = sessionCookie(owner);
    await app.inject({
      method: "POST",
      url: `/api/orgs/${owner.json().org.id}/workspaces`,
      headers: { cookie },
      payload: { workspaceId: "dw" },
    });

    const build = await app.inject({ method: "POST", url: "/api/workspaces/dw/build", headers: { cookie } });
    expect(build.statusCode).toBe(202);
    await manager.wait(build.json().jobId);

    const rows = await tenancy.listProvenance("dw");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.target).toBe("summary");
    expect(rows[0]!.orgId).toBe(owner.json().org.id);
  });
});
