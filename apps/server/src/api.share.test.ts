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
import { buildApi, type ApiDeps } from "./api.js";
import { SharingService, InMemoryShareStore } from "./sharing/index.js";
import { TenancyService, InMemoryTenancyStore } from "./tenancy/index.js";

const exec = promisify(execFile);

class FakeProvider implements Provider {
  readonly id = "fake";
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: `# Summary\n\nOf ${req.prompt.length} chars.`, usage: { input: 5, output: 7 }, costUsd: 0.02 };
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

describe("sharing routes", () => {
  let root: string;
  let app: FastifyInstance;
  let manager: BuildManager;
  let sharing: SharingService;

  async function makeWorkspace(id: string): Promise<void> {
    const dir = join(root, id);
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources/a.md"), "raw notes", "utf8");
    await writeFile(join(dir, "build.md"), DOC, "utf8");
    await exec("git", ["init", "-b", "main"], { cwd: dir });
    await exec("git", ["config", "user.email", "t@t.dev"], { cwd: dir });
    await exec("git", ["config", "user.name", "T"], { cwd: dir });
  }

  function makeApp(over: Partial<ApiDeps> = {}): FastifyInstance {
    return buildApi({
      store: new WorkspaceStore(root),
      manager,
      sharing,
      contextFactory: (dir: string, hooks: ServerContextHooks): BuildContext => ({
        workspaceDir: dir,
        cas: new LocalCas(join(dir, ".makedown")),
        provider: new FakeProvider(),
        onProgress: hooks.onProgress,
        approve: hooks.approve,
      }),
      ...over,
    });
  }

  /** Build `target` so its artifact exists in the CAS, then return when settled. */
  async function build(workspaceId: string, cookie?: string): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspaceId}/build`,
      headers: cookie ? { cookie } : {},
    });
    await manager.wait(res.json().jobId);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdshareapi-"));
    manager = new BuildManager();
    sharing = new SharingService(new InMemoryShareStore());
  });
  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  describe("single-tenant (no auth)", () => {
    beforeEach(async () => {
      app = makeApp();
      await app.ready();
      await makeWorkspace("proj");
    });

    it("creates a public link to a built artifact and serves it with no auth", async () => {
      await build("proj");
      const create = await app.inject({
        method: "POST",
        url: "/api/workspaces/proj/artifacts/summary/share",
        payload: { includeProvenance: false },
      });
      expect(create.statusCode).toBe(201);
      const { token, path } = create.json();
      expect(path).toBe(`/s/${token}`);

      const view = await app.inject({ method: "GET", url: path });
      expect(view.statusCode).toBe(200);
      expect(view.headers["content-type"]).toMatch(/text\/html/);
      expect(view.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(view.body).toContain("<strong>"); // markdown rendered
      expect(view.body).toContain("Summary");
    });

    it("refuses to share an artifact that has not been built", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/workspaces/proj/artifacts/summary/share",
      });
      expect(create.statusCode).toBe(404);
    });

    it("omits provenance by default and includes it when requested", async () => {
      await build("proj");
      const off = await app.inject({
        method: "POST",
        url: "/api/workspaces/proj/artifacts/summary/share",
        payload: { includeProvenance: false },
      });
      const offView = await app.inject({ method: "GET", url: off.json().path });
      expect(offView.body).not.toContain("fake");

      const on = await app.inject({
        method: "POST",
        url: "/api/workspaces/proj/artifacts/summary/share",
        payload: { includeProvenance: true },
      });
      const onView = await app.inject({ method: "GET", url: on.json().path });
      expect(onView.body).toContain("fake"); // provenance model name
    });

    it("stops serving a revoked link (opaque 404 HTML, not JSON)", async () => {
      await build("proj");
      const create = await app.inject({
        method: "POST",
        url: "/api/workspaces/proj/artifacts/summary/share",
      });
      const { id, path } = create.json();
      expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(200);

      const del = await app.inject({ method: "DELETE", url: `/api/shares/${id}` });
      expect(del.statusCode).toBe(200);

      const after = await app.inject({ method: "GET", url: path });
      expect(after.statusCode).toBe(404);
      expect(after.headers["content-type"]).toMatch(/text\/html/);
      expect(after.body.toLowerCase()).toContain("not found");
    });

    it("returns an opaque 404 for an unknown token", async () => {
      const res = await app.inject({ method: "GET", url: "/s/this-is-not-a-token" });
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    });

    it("lists a workspace's shares without exposing token material", async () => {
      await build("proj");
      await app.inject({ method: "POST", url: "/api/workspaces/proj/artifacts/summary/share" });
      const list = await app.inject({ method: "GET", url: "/api/workspaces/proj/shares" });
      expect(list.json().shares).toHaveLength(1);
      expect(list.body).not.toMatch(/tokenHash|token"/);
    });

    it("rate-limits the public route", async () => {
      await build("proj");
      const { path } = (
        await app.inject({ method: "POST", url: "/api/workspaces/proj/artifacts/summary/share" })
      ).json();
      let limited = false;
      for (let i = 0; i < 65; i++) {
        const res = await app.inject({ method: "GET", url: path });
        if (res.statusCode === 429) {
          limited = true;
          break;
        }
      }
      expect(limited).toBe(true);
    });
  });

  describe("team mode (RBAC)", () => {
    let tenancy: TenancyService;

    beforeEach(async () => {
      tenancy = new TenancyService(new InMemoryTenancyStore());
      app = makeApp({ tenancy });
      await app.ready();
      await makeWorkspace("proj");
    });

    async function signup(email: string): Promise<{ cookie: string; orgId: string }> {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email, password: "a-good-password" },
      });
      return { cookie: sessionCookie(res), orgId: res.json().org.id };
    }

    it("lets a member create a share but denies a viewer", async () => {
      const owner = await signup("owner@example.com");
      await app.inject({
        method: "POST",
        url: `/api/orgs/${owner.orgId}/workspaces`,
        headers: { cookie: owner.cookie },
        payload: { workspaceId: "proj" },
      });
      await build("proj", owner.cookie);

      // owner (≥ member) can share
      const ok = await app.inject({
        method: "POST",
        url: "/api/workspaces/proj/artifacts/summary/share",
        headers: { cookie: owner.cookie },
      });
      expect(ok.statusCode).toBe(201);

      // a viewer in the same org cannot
      const viewer = await signup("viewer@example.com");
      await tenancy.addMemberByEmail(owner.orgId, "viewer@example.com", "viewer");
      const denied = await app.inject({
        method: "POST",
        url: "/api/workspaces/proj/artifacts/summary/share",
        headers: { cookie: viewer.cookie },
      });
      expect(denied.statusCode).toBe(403);

      // but the public link the owner made needs no auth at all
      const publicView = await app.inject({ method: "GET", url: ok.json().path });
      expect(publicView.statusCode).toBe(200);
    });

    it("requires authentication to create a share", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces/proj/artifacts/summary/share",
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
