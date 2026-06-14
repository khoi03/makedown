# @makedown/server — AGPL-3.0

The server backend: build orchestration, SSE progress streaming, git snapshots,
and (Phase 2.4) authentication, team RBAC, an optional Postgres provenance index,
and public read-only **shared artifact views**. Wraps the Apache-2.0 engine;
provides the control plane the CLI does not.

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

**License:** **AGPL-3.0** (see [`LICENSE`](./LICENSE)) — dual-licensed; a
commercial exception is available, see [`/LICENSING.md`](../../LICENSING.md) and
`PLAN.md` §15.
