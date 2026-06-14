/**
 * The Fastify HTTP/SSE API. Pure HTTP — the realtime sync WebSocket is mounted
 * separately in main.ts on the same server. Routes are thin: they resolve a
 * workspace (path-safe), then delegate to the engine read-services, the build
 * manager, and the git persistence layer.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  commitSnapshot,
  listSnapshots,
  currentBranch,
  listBranches,
  checkoutBranch,
  type GitAuthor,
} from "@makedown/sync";
import type { BuildContext } from "@makedown/engine";
import {
  WorkspaceStore,
  InvalidWorkspaceIdError,
  WorkspaceNotFoundError,
  loadDoc,
  makeServerContext,
  type ServerContextHooks,
} from "./workspace.js";
import { BuildManager } from "./builds.js";
import { getGraph, getArtifact, getProvenance, getCost } from "./artifacts.js";
import { collectProvenanceRows } from "./provenance-index.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerShareRoutes } from "./share-routes.js";
import { registerAnalyticsRoutes } from "./analytics-routes.js";
import { SharingService, InMemoryShareStore } from "./sharing/index.js";
import { NullTenancy, type TenancyProvider, type Principal, type Action } from "./tenancy/index.js";
import { SESSION_COOKIE, parseCookie } from "./tenancy/cookies.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The authenticated caller, set by the session preHandler (undefined when off). */
    user?: Principal;
  }
}

export interface ApiDeps {
  readonly store: WorkspaceStore;
  readonly manager: BuildManager;
  /** Override the build context factory (tests inject a fake provider). */
  readonly contextFactory?: (dir: string, hooks: ServerContextHooks) => BuildContext;
  /** Materialize the live doc to disk before a plan/build/snapshot (set by main). */
  readonly flushWorkspace?: (id: string) => Promise<void>;
  /** Reload the live doc from disk after a branch switch (set by main). */
  readonly reloadWorkspace?: (id: string) => Promise<void>;
  /** Commit author for snapshots. */
  readonly author?: GitAuthor;
  /** Fastify logger toggle. */
  readonly logger?: boolean;
  /** Tenancy provider. Defaults to the permissive single-tenant NullTenancy. */
  readonly tenancy?: TenancyProvider;
  /**
   * Sharing service (public read-only artifact links). Works in both modes;
   * defaults to an in-memory store (fine for tests — main wires a durable one).
   */
  readonly sharing?: SharingService;
  /** Override the public share-view rate limit (defaults in share-routes). */
  readonly shareRateLimit?: { readonly max: number; readonly windowMs: number };
  /** Override the analytics read rate limit (defaults in analytics-routes). */
  readonly analyticsRateLimit?: { readonly max: number; readonly windowMs: number };
  /** Set the Secure attribute on the session cookie (HTTPS deployments). */
  readonly secureCookies?: boolean;
}

interface IdParams {
  id: string;
}

export function buildApi(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const contextFactory = deps.contextFactory ?? makeServerContext;
  const tenancy = deps.tenancy ?? new NullTenancy();
  const sharing = deps.sharing ?? new SharingService(new InMemoryShareStore());

  app.decorateRequest("user", undefined);

  // Resolve the session cookie to a principal on every request. A no-op under
  // NullTenancy (authenticate always returns undefined), so single-tenant
  // behavior is unchanged.
  app.addHook("preHandler", async (req) => {
    if (!tenancy.enabled) return;
    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    req.user = await tenancy.authenticate(token);
  });

  /**
   * Enforce that the caller may perform `action` on `workspaceId`. Returns true
   * when allowed; otherwise writes a 401/403 and returns false. Always allows
   * when tenancy is disabled (single-tenant mode).
   */
  async function ensureAuthorized(
    req: FastifyRequest,
    reply: FastifyReply,
    workspaceId: string,
    action: Action,
  ): Promise<boolean> {
    if (!tenancy.enabled) return true;
    if (!req.user) {
      reply.code(401).send({ error: "Authentication required" });
      return false;
    }
    if (!(await tenancy.authorize(req.user.userId, workspaceId, action))) {
      reply.code(403).send({ error: "You do not have access to this workspace" });
      return false;
    }
    return true;
  }

  /** Authorize a job-scoped route by the job's owning workspace. */
  async function ensureJobAccess(
    req: FastifyRequest,
    reply: FastifyReply,
    jobId: string,
    action: Action,
  ): Promise<boolean> {
    const job = deps.manager.get(jobId);
    if (!job) {
      reply.code(404).send({ error: "Unknown build job" });
      return false;
    }
    return ensureAuthorized(req, reply, job.workspaceId, action);
  }

  // Treat an empty JSON body as "no body" instead of erroring, so bodyless
  // POSTs (e.g. starting a build) succeed regardless of how the client sets the
  // content-type header. Non-empty bodies parse as normal JSON.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const text = typeof body === "string" ? body.trim() : "";
      if (text.length === 0) return done(null, undefined);
      try {
        done(null, JSON.parse(text));
      } catch {
        const err = new Error("Invalid JSON body") as Error & { statusCode?: number };
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

  app.setErrorHandler((error: Error, req, reply) => {
    if (error instanceof InvalidWorkspaceIdError) return reply.code(400).send({ error: error.message });
    if (error instanceof WorkspaceNotFoundError) return reply.code(404).send({ error: error.message });
    if (error.name === "InvalidBranchNameError") return reply.code(400).send({ error: error.message });
    if (error.name === "BuildDocParseError") return reply.code(422).send({ error: error.message });
    if (/^Unknown target:/.test(error.message)) return reply.code(404).send({ error: error.message });
    // Honor a framework error's own client-error status (e.g. Fastify's
    // FST_ERR_CTP_EMPTY_JSON_BODY = 400) rather than masking it as a 500.
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: error.message, name: error.name });
    }
    // Unexpected: log the full error (name + stack) so 500s are diagnosable.
    req.log.error({ err: error }, `unhandled error on ${req.method} ${req.url}`);
    reply.code(500).send({ error: error.message, name: error.name });
  });

  app.get("/api/health", async () => ({ ok: true }));

  registerAuthRoutes(app, { tenancy, secureCookies: deps.secureCookies ?? false });
  registerShareRoutes(app, { sharing, store: deps.store, ensureAuthorized, rateLimit: deps.shareRateLimit });
  registerAnalyticsRoutes(app, { tenancy, rateLimit: deps.analyticsRateLimit });

  app.get("/api/workspaces", async (req, reply) => {
    const all = await deps.store.list();
    if (!tenancy.enabled) return { workspaces: all };
    if (!req.user) return reply.code(401).send({ error: "Authentication required" });
    // Intersect the on-disk workspaces with the ones this user can access.
    const accessible = await tenancy.accessibleWorkspaceIds(req.user.userId);
    const workspaces = accessible ? all.filter((id) => accessible.has(id)) : all;
    return { workspaces };
  });

  // On-disk workspaces not yet claimed by any org — what a signed-in user can
  // add to their org. Empty in single-tenant mode.
  app.get("/api/workspaces/available", async (req, reply) => {
    if (!tenancy.enabled) return { workspaces: [] };
    if (!req.user) return reply.code(401).send({ error: "Authentication required" });
    const all = await deps.store.list();
    return { workspaces: await tenancy.unregisteredWorkspaceIds(all) };
  });

  app.get("/api/orgs", async (req, reply) => {
    if (!tenancy.enabled) return { orgs: [] };
    if (!req.user) return reply.code(401).send({ error: "Authentication required" });
    return { orgs: await tenancy.listOrgs(req.user.userId) };
  });

  // Register an existing on-disk workspace under an org so its members can access
  // it. Authorization (must be able to create workspaces in the org) is enforced
  // inside the provider.
  app.post<{ Params: { orgId: string }; Body: { workspaceId?: string } }>(
    "/api/orgs/:orgId/workspaces",
    async (req, reply) => {
      if (!tenancy.enabled) return reply.code(404).send({ error: "Authentication is disabled" });
      if (!req.user) return reply.code(401).send({ error: "Authentication required" });
      const workspaceId = req.body?.workspaceId?.trim();
      if (!workspaceId) return reply.code(400).send({ error: "workspaceId is required" });
      await deps.store.open(workspaceId); // 404/400 if the dir is missing or unsafe
      try {
        await tenancy.registerWorkspace(req.user.userId, req.params.orgId, workspaceId);
      } catch {
        return reply.code(403).send({ error: "Could not register workspace" });
      }
      return reply.code(201).send({ workspaceId, orgId: req.params.orgId });
    },
  );

  app.get<{ Params: IdParams }>("/api/workspaces/:id/graph", async (req, reply) => {
    if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:read"))) return reply;
    const dir = await deps.store.open(req.params.id);
    await deps.flushWorkspace?.(req.params.id);
    return getGraph(dir);
  });

  app.get<{ Params: IdParams }>("/api/workspaces/:id/cost", async (req, reply) => {
    if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:read"))) return reply;
    const dir = await deps.store.open(req.params.id);
    await deps.flushWorkspace?.(req.params.id);
    return getCost(dir);
  });

  app.post<{ Params: IdParams }>("/api/workspaces/:id/build", async (req, reply) => {
    const id = req.params.id;
    if (!(await ensureAuthorized(req, reply, id, "workspace:build"))) return reply;
    const dir = await deps.store.open(id);
    await deps.flushWorkspace?.(id);
    const doc = await loadDoc(dir);
    const job = deps.manager.start({
      workspaceId: id,
      doc,
      makeContext: (hooks) => contextFactory(dir, hooks),
      // Dual-write provenance for the built targets into the tenancy index
      // (no-op under NullTenancy). The CAS remains the canonical source.
      onResult: async (settled) => {
        const built = settled.result?.built ?? [];
        if (built.length === 0) return;
        const rows = await collectProvenanceRows(dir, id, built);
        await tenancy.recordProvenance(id, rows);
      },
    });
    return reply.code(202).send({ jobId: job.id });
  });

  app.get<{ Params: IdParams }>("/api/workspaces/:id/builds", async (req, reply) => {
    if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:read"))) return reply;
    await deps.store.open(req.params.id);
    return { builds: deps.manager.list(req.params.id) };
  });

  app.get<{ Params: { jobId: string } }>("/api/builds/:jobId", async (req, reply) => {
    if (!(await ensureJobAccess(req, reply, req.params.jobId, "workspace:read"))) return reply;
    return deps.manager.get(req.params.jobId);
  });

  app.get<{ Params: { jobId: string } }>("/api/builds/:jobId/events", async (req, reply) => {
    if (!(await ensureJobAccess(req, reply, req.params.jobId, "workspace:read"))) return reply;

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    const unsubscribe = deps.manager.subscribe(req.params.jobId, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "done" || event.type === "error") reply.raw.end();
    });
    req.raw.on("close", unsubscribe);
    return reply;
  });

  app.post<{ Params: { jobId: string; approvalId: string }; Body: { approved?: boolean } }>(
    "/api/builds/:jobId/approvals/:approvalId",
    async (req, reply) => {
      if (!(await ensureJobAccess(req, reply, req.params.jobId, "approval:resolve"))) return reply;
      const ok = deps.manager.resolveApproval(req.params.approvalId, req.body?.approved === true);
      if (!ok) return reply.code(404).send({ error: "Unknown or already-resolved approval" });
      return { resolved: true };
    },
  );

  app.get<{ Params: { id: string; target: string } }>(
    "/api/workspaces/:id/artifacts/:target",
    async (req, reply) => {
      if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:read"))) return reply;
      const dir = await deps.store.open(req.params.id);
      const artifact = await getArtifact(dir, req.params.target);
      if (!artifact) return reply.code(404).send({ error: "Artifact not built" });
      return artifact;
    },
  );

  app.get<{ Params: { id: string; target: string } }>(
    "/api/workspaces/:id/artifacts/:target/why",
    async (req, reply) => {
      if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:read"))) return reply;
      const dir = await deps.store.open(req.params.id);
      const provenance = await getProvenance(dir, req.params.target);
      if (!provenance) return reply.code(404).send({ error: "Artifact not built" });
      return provenance;
    },
  );

  app.get<{ Params: IdParams }>("/api/workspaces/:id/snapshots", async (req, reply) => {
    if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:read"))) return reply;
    const dir = await deps.store.open(req.params.id);
    return { snapshots: await listSnapshots(dir) };
  });

  app.post<{ Params: IdParams; Body: { message?: string } }>(
    "/api/workspaces/:id/snapshots",
    async (req, reply) => {
      if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:snapshot"))) return reply;
      const dir = await deps.store.open(req.params.id);
      const message = req.body?.message?.trim();
      if (!message) return reply.code(400).send({ error: "A snapshot message is required" });
      await deps.flushWorkspace?.(req.params.id);
      const sha = await commitSnapshot(dir, message, deps.author);
      if (!sha) return reply.code(409).send({ error: "Nothing to snapshot — no changes" });
      return reply.code(201).send({ sha });
    },
  );

  app.get<{ Params: IdParams }>("/api/workspaces/:id/branches", async (req, reply) => {
    if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:read"))) return reply;
    const dir = await deps.store.open(req.params.id);
    return { current: await currentBranch(dir), branches: await listBranches(dir) };
  });

  app.post<{ Params: IdParams; Body: { name?: string; create?: boolean } }>(
    "/api/workspaces/:id/branches",
    async (req, reply) => {
      if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:branch"))) return reply;
      const dir = await deps.store.open(req.params.id);
      const name = req.body?.name?.trim();
      if (!name) return reply.code(400).send({ error: "A branch name is required" });
      await deps.flushWorkspace?.(req.params.id);
      await checkoutBranch(dir, name, { create: req.body?.create === true });
      await deps.reloadWorkspace?.(req.params.id);
      return { current: await currentBranch(dir) };
    },
  );

  return app;
}
