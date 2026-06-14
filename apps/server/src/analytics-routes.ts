/**
 * Analytics routes: a read-only, org-scoped view over the provenance index
 * (cost / tokens / runs sliced by workspace, model, target, and day).
 *
 * Behind the tenancy seam:
 *  - tenancy disabled (single-tenant, no DATABASE_URL) → `{ enabled: false }`,
 *    with NO auth wall, so the dashboard renders a graceful "team-mode only"
 *    empty state instead of an error;
 *  - tenancy enabled → require a session and org membership (`analytics:read`)
 *    before returning aggregates, so one org can never read another's spend.
 */
import type { FastifyInstance } from "fastify";
import type { TenancyProvider, AnalyticsRange } from "./tenancy/index.js";
import { FixedWindowLimiter } from "./tenancy/rate-limit.js";

/**
 * Per-IP throttle for the analytics read endpoint. Reads are cheaper than auth,
 * but each fans out into several indexed `GROUP BY` scans, so a generous-but-real
 * cap keeps one client from hammering the index. Override via `rateLimit`.
 */
const ANALYTICS_MAX_REQUESTS = 60;
const ANALYTICS_WINDOW_MS = 60 * 1000;

export interface AnalyticsRoutesDeps {
  readonly tenancy: TenancyProvider;
  readonly rateLimit?: { readonly max: number; readonly windowMs: number };
}

interface RangeQuery {
  from?: string;
  to?: string;
}

export function registerAnalyticsRoutes(app: FastifyInstance, deps: AnalyticsRoutesDeps): void {
  const { tenancy } = deps;
  const windowMs = deps.rateLimit?.windowMs ?? ANALYTICS_WINDOW_MS;
  const limiter = new FixedWindowLimiter({ max: deps.rateLimit?.max ?? ANALYTICS_MAX_REQUESTS, windowMs });

  app.get<{ Params: { orgId: string }; Querystring: RangeQuery }>(
    "/api/orgs/:orgId/analytics",
    async (req, reply) => {
      // Throttle per client IP before any work — protects the index from a flood
      // (and an unauthenticated client from spamming even the empty-state probe).
      if (!limiter.allow(req.ip)) {
        reply.header("retry-after", Math.ceil(windowMs / 1000));
        return reply.code(429).send({ error: "Too many requests" });
      }

      // Single-tenant: no index, no auth wall — signal the empty state.
      if (!tenancy.enabled) return { enabled: false };

      if (!req.user) return reply.code(401).send({ error: "Authentication required" });

      const range = parseRange(req.query);
      if (range === "invalid") {
        return reply.code(400).send({ error: "Invalid date filter; expected an ISO date" });
      }

      const allowed = await tenancy.authorizeOrg(req.user.userId, req.params.orgId, "analytics:read");
      if (!allowed) return reply.code(403).send({ error: "You do not have access to this organization" });

      const summary = await tenancy.analytics(req.params.orgId, range);
      return { enabled: true, summary };
    },
  );
}

/**
 * Validate the optional `from`/`to` query params into a half-open window.
 * Each is normalized to canonical ISO so the store's lexical comparison against
 * the ISO `producedAt` is well-defined. Returns `"invalid"` on a malformed date.
 */
function parseRange(query: RangeQuery): AnalyticsRange | "invalid" {
  const from = normalizeDate(query.from);
  if (from === "invalid") return "invalid";
  const to = normalizeDate(query.to);
  if (to === "invalid") return "invalid";
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/** Returns the canonical ISO string, `undefined` if absent, or `"invalid"`. */
function normalizeDate(value: string | undefined): string | undefined | "invalid" {
  if (value === undefined || value === "") return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "invalid";
  return new Date(ms).toISOString();
}
