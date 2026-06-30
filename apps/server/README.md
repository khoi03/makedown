# @makedown/server — AGPL-3.0

The server backend: build orchestration, SSE progress streaming, git snapshots,
and (Phase 2.4) authentication, team RBAC, an optional Postgres provenance index,
public read-only **shared artifact views**, and (Phase 3) a **cost analytics**
read-API over the provenance index. Wraps the Apache-2.0 engine; provides the
control plane the CLI does not.

## Sharing (`src/sharing/`, `src/share-routes.ts`)

A `SharingService` over a repository-pattern `ShareStore` turns a built artifact
into a public, revocable, optionally-expiring link. Tokens are 256-bit CSPRNG and
stored only as a SHA-256 hash (reusing the tenancy auth primitives). Authoring
routes (`POST …/artifacts/:target/share`, `GET …/shares`, `DELETE /api/shares/:id`)
are authorized by the `share:create` / `workspace:read` RBAC actions; the public
`GET /s/:token` route is **no-auth**, hardened with a strict CSP, a uniform HTML
404 (no oracle), and a per-IP rate limiter, and renders Markdown through a
`sanitize-html` allow-list (non-Markdown as escaped `<pre>`). It works with **no
database** (a durable file-backed registry under the workspaces root) or with
`DATABASE_URL` (Postgres, same connection as tenancy).

## Cost analytics (`src/analytics-routes.ts`)

`GET /api/orgs/:orgId/analytics?from=&to=` aggregates the provenance index into
cost / tokens / run-count breakdowns by **workspace, model, target, and day**
within an optional half-open `[from, to)` window (ISO dates; malformed → 400).
Aggregation is pushed into the data layer — four indexed `GROUP BY`s plus one
totals scan, backed by a composite `(org_id, produced_at)` index — so the full
row set is never materialized. It is **org-scoped**: a session plus org
membership (`analytics:read`, viewer+) is required, so one org can never read
another's spend. With **no `DATABASE_URL`** the route returns `{ enabled: false }`
(no index, no auth wall) so the dashboard can render a graceful empty state.

The endpoint is **rate-limited per client IP** (default 60/min) — checked before
auth/DB work, returning `429` with a `Retry-After` header so a flood can't reach
the index. Tune it at runtime with **`MAKEDOWN_ANALYTICS_RATE_LIMIT`** (max
requests per minute; invalid/blank → the 60/min default), or programmatically via
`ApiDeps.analyticsRateLimit`.

Semantics: the index is keyed by `(workspace, identity-hash)` and upserted, so
figures measure **distinct artifact production** cost — cache-hit / no-op
rebuilds do not re-accrue. The index never contains the resolved prompt/params
(those stay in the CAS), so analytics leaks no prompt content. Day buckets are
UTC calendar days.

**License:** **AGPL-3.0** (see [`LICENSE`](./LICENSE)) — dual-licensed; a
commercial exception is available, see [`/LICENSING.md`](../../LICENSING.md) and
[`docs/ROADMAP.md`](../../docs/ROADMAP.md) §15.
