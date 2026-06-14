/**
 * Sharing routes: authoring (create/list/revoke a share — authorized like any
 * workspace action) and the public, no-auth `/s/:token` view. The public route
 * is the most exposed surface in the server, so it is hardened independently:
 *  - an unguessable token + uniform 404 (no revoked/expired/not-found oracle),
 *  - its own per-IP rate limiter (brute-force / DoS resistance),
 *  - a strict `Content-Security-Policy` (no scripts, no framing) layered on top
 *    of the already-sanitized {@link renderSharePage} output,
 *  - HTML (never JSON) responses, so a bad link reveals nothing about internals.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WorkspaceStore } from "./workspace.js";
import { getArtifact } from "./artifacts.js";
import { SharingService, renderSharePage, renderNotFoundPage } from "./sharing/index.js";
import { FixedWindowLimiter } from "./tenancy/rate-limit.js";
import type { Action } from "./tenancy/index.js";

// Public view brute-force guard: generous for humans, bounded against scanners.
const PUBLIC_MAX_REQUESTS = 60;
const PUBLIC_WINDOW_MS = 60 * 1000;

/** Defense-in-depth headers for the static, no-auth public page. */
const PUBLIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy":
    "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

export interface ShareRoutesDeps {
  readonly sharing: SharingService;
  readonly store: WorkspaceStore;
  /** Reuse the API's authorizer so share routes obey the same RBAC. */
  readonly ensureAuthorized: (
    req: FastifyRequest,
    reply: FastifyReply,
    workspaceId: string,
    action: Action,
  ) => Promise<boolean>;
  /** Injectable clock for the public limiter (tests). */
  readonly now?: () => number;
}

interface CreateShareBody {
  includeProvenance?: unknown;
  expiresInDays?: unknown;
}

export function registerShareRoutes(app: FastifyInstance, deps: ShareRoutesDeps): void {
  const { sharing, store, ensureAuthorized } = deps;
  const limiter = new FixedWindowLimiter({
    max: PUBLIC_MAX_REQUESTS,
    windowMs: PUBLIC_WINDOW_MS,
    now: deps.now,
  });

  function sendPage(reply: FastifyReply, code: number, html: string): FastifyReply {
    reply.code(code);
    for (const [name, value] of Object.entries(PUBLIC_SECURITY_HEADERS)) reply.header(name, value);
    reply.header("content-type", "text/html; charset=utf-8");
    return reply.send(html);
  }

  // Create a read-only public link to a built artifact.
  app.post<{ Params: { id: string; target: string }; Body: CreateShareBody }>(
    "/api/workspaces/:id/artifacts/:target/share",
    async (req, reply) => {
      const { id, target } = req.params;
      if (!(await ensureAuthorized(req, reply, id, "share:create"))) return reply;
      const dir = await store.open(id);
      // Only built artifacts can be shared — a stale/never-built target 404s.
      const artifact = await getArtifact(dir, target);
      if (!artifact) return reply.code(404).send({ error: "Artifact not built" });
      const includeProvenance = req.body?.includeProvenance === true;
      const expiresInDays = toExpiryDays(req.body?.expiresInDays);
      const created = await sharing.createShare({ workspaceId: id, target, includeProvenance, expiresInDays });
      return reply.code(201).send(created);
    },
  );

  // List a workspace's shares (no token material is returned).
  app.get<{ Params: { id: string } }>("/api/workspaces/:id/shares", async (req, reply) => {
    if (!(await ensureAuthorized(req, reply, req.params.id, "workspace:read"))) return reply;
    await store.open(req.params.id);
    return { shares: await sharing.listShares(req.params.id) };
  });

  // Revoke a share by id (authorized against the share's owning workspace).
  app.delete<{ Params: { shareId: string } }>("/api/shares/:shareId", async (req, reply) => {
    const workspaceId = await sharing.workspaceForShare(req.params.shareId);
    if (!workspaceId) return reply.code(404).send({ error: "Unknown share" });
    if (!(await ensureAuthorized(req, reply, workspaceId, "share:create"))) return reply;
    await sharing.revokeShare(req.params.shareId);
    return { revoked: true };
  });

  // The public, no-auth view. Always responds with HTML; never leaks internals.
  app.get<{ Params: { token: string } }>("/s/:token", async (req, reply) => {
    if (!limiter.allow(req.ip)) return sendPage(reply, 429, renderNotFoundPage());
    try {
      const share = await sharing.resolveShare(req.params.token);
      if (!share) return sendPage(reply, 404, renderNotFoundPage());
      const dir = await store.open(share.workspaceId);
      const artifact = await getArtifact(dir, share.target);
      if (!artifact) return sendPage(reply, 404, renderNotFoundPage());
      const html = renderSharePage({
        target: artifact.target,
        output: artifact.provenance.output,
        content: artifact.content,
        provenance: share.includeProvenance ? artifact.provenance : undefined,
      });
      return sendPage(reply, 200, html);
    } catch (error) {
      // A resolved share could point at a workspace that has since been removed
      // or rebuilt away — fail closed with the same opaque 404, and log server-side.
      req.log.error({ err: error }, "failed to render shared artifact");
      return sendPage(reply, 404, renderNotFoundPage());
    }
  });
}

/** Coerce an untrusted expiry to a positive integer day count, or undefined. */
function toExpiryDays(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}
