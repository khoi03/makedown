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
}

interface IdParams {
  id: string;
}

export function buildApi(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const contextFactory = deps.contextFactory ?? makeServerContext;

  app.setErrorHandler((error: Error, req, reply) => {
    if (error instanceof InvalidWorkspaceIdError) return reply.code(400).send({ error: error.message });
    if (error instanceof WorkspaceNotFoundError) return reply.code(404).send({ error: error.message });
    if (error.name === "InvalidBranchNameError") return reply.code(400).send({ error: error.message });
    if (error.name === "BuildDocParseError") return reply.code(422).send({ error: error.message });
    if (/^Unknown target:/.test(error.message)) return reply.code(404).send({ error: error.message });
    // Unexpected: log the full error (name + stack) so 500s are diagnosable.
    req.log.error({ err: error }, `unhandled error on ${req.method} ${req.url}`);
    reply.code(500).send({ error: error.message, name: error.name });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/workspaces", async () => ({ workspaces: await deps.store.list() }));

  app.get<{ Params: IdParams }>("/api/workspaces/:id/graph", async (req) => {
    const dir = await deps.store.open(req.params.id);
    await deps.flushWorkspace?.(req.params.id);
    return getGraph(dir);
  });

  app.get<{ Params: IdParams }>("/api/workspaces/:id/cost", async (req) => {
    const dir = await deps.store.open(req.params.id);
    await deps.flushWorkspace?.(req.params.id);
    return getCost(dir);
  });

  app.post<{ Params: IdParams }>("/api/workspaces/:id/build", async (req, reply) => {
    const id = req.params.id;
    const dir = await deps.store.open(id);
    await deps.flushWorkspace?.(id);
    const doc = await loadDoc(dir);
    const job = deps.manager.start({
      workspaceId: id,
      doc,
      makeContext: (hooks) => contextFactory(dir, hooks),
    });
    return reply.code(202).send({ jobId: job.id });
  });

  app.get<{ Params: IdParams }>("/api/workspaces/:id/builds", async (req) => {
    await deps.store.open(req.params.id);
    return { builds: deps.manager.list(req.params.id) };
  });

  app.get<{ Params: { jobId: string } }>("/api/builds/:jobId", async (req, reply) => {
    const job = deps.manager.get(req.params.jobId);
    if (!job) return reply.code(404).send({ error: "Unknown build job" });
    return job;
  });

  app.get<{ Params: { jobId: string } }>("/api/builds/:jobId/events", (req, reply) => {
    const job = deps.manager.get(req.params.jobId);
    if (!job) return reply.code(404).send({ error: "Unknown build job" });

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
      const ok = deps.manager.resolveApproval(req.params.approvalId, req.body?.approved === true);
      if (!ok) return reply.code(404).send({ error: "Unknown or already-resolved approval" });
      return { resolved: true };
    },
  );

  app.get<{ Params: { id: string; target: string } }>(
    "/api/workspaces/:id/artifacts/:target",
    async (req, reply) => {
      const dir = await deps.store.open(req.params.id);
      const artifact = await getArtifact(dir, req.params.target);
      if (!artifact) return reply.code(404).send({ error: "Artifact not built" });
      return artifact;
    },
  );

  app.get<{ Params: { id: string; target: string } }>(
    "/api/workspaces/:id/artifacts/:target/why",
    async (req, reply) => {
      const dir = await deps.store.open(req.params.id);
      const provenance = await getProvenance(dir, req.params.target);
      if (!provenance) return reply.code(404).send({ error: "Artifact not built" });
      return provenance;
    },
  );

  app.get<{ Params: IdParams }>("/api/workspaces/:id/snapshots", async (req) => {
    const dir = await deps.store.open(req.params.id);
    return { snapshots: await listSnapshots(dir) };
  });

  app.post<{ Params: IdParams; Body: { message?: string } }>(
    "/api/workspaces/:id/snapshots",
    async (req, reply) => {
      const dir = await deps.store.open(req.params.id);
      const message = req.body?.message?.trim();
      if (!message) return reply.code(400).send({ error: "A snapshot message is required" });
      await deps.flushWorkspace?.(req.params.id);
      const sha = await commitSnapshot(dir, message, deps.author);
      if (!sha) return reply.code(409).send({ error: "Nothing to snapshot — no changes" });
      return reply.code(201).send({ sha });
    },
  );

  app.get<{ Params: IdParams }>("/api/workspaces/:id/branches", async (req) => {
    const dir = await deps.store.open(req.params.id);
    return { current: await currentBranch(dir), branches: await listBranches(dir) };
  });

  app.post<{ Params: IdParams; Body: { name?: string; create?: boolean } }>(
    "/api/workspaces/:id/branches",
    async (req, reply) => {
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
