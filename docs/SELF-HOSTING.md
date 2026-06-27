# Self-hosting the Makedown app

The collaborative workbench is the AGPL-3.0 part of Makedown: a **server**
(Fastify API + sync WebSocket) and a **web** app (React/Vite). The CLI alone needs
none of this — see the [README](../README.md) quickstart.

There are two ways to run it: **Docker** (fastest) or **from source**.

## Option A — Docker

```bash
docker compose up --build
# → web:    http://localhost:5173
# → server: http://localhost:4000  (workspaces: ./examples)
```

By default this mounts the bundled [`examples/`](../examples) directory as the
workspaces root and runs single-tenant (no auth). To serve your own workspaces,
point the bind mount at your directory:

```yaml
# docker-compose.yml → services.server.volumes
- /path/to/your/workspaces:/workspaces
```

Each workspace must be a git repo with a `build.md` (snapshots/branches use git).
Model credentials and team mode are configured with the environment variables
below — pass them through in `docker-compose.yml` or an `.env` file.

To enable teams, start the optional Postgres service:

```bash
docker compose --profile teams up --build   # adds Postgres and sets DATABASE_URL
```

## Option B — From source

The workbench is two processes; the Vite dev server proxies `/api` + `/sync` to
the API server.

```bash
# 0) build the workspace packages the server imports
pnpm install
pnpm build

# 1) each workspace must be a git repo with a build.md (snapshots/branches use git)
git -C examples/quickstart init -q -b main   # once per example, if not already

# 2) start the server (bash; PowerShell: use $env:NAME = "...")
export MAKEDOWN_WORKSPACES_ROOT="$PWD/examples"
export PORT=4000
export ANTHROPIC_API_KEY=sk-ant-...          # optional — omit for transform-only builds
node apps/server/dist/main.js
# → Makedown server listening on http://127.0.0.1:4000 (workspaces: .../examples)

# 3) in a second terminal, start the web app
pnpm --filter @makedown/web dev
# → open http://localhost:5173, pick a workspace, or deep-link: .../#/quickstart
```

In the workbench: the left **Files** pane lists `build.md` plus every source —
click one to open it in the collaborative editor (open the same URL in two tabs to
see live co-editing + presence cursors); the **DAG** updates as you type; **Build**
runs stale targets and streams status onto the graph; click a node to inspect its
**artifact / provenance / cost**; **Snapshot** commits to git; the branch chip
switches/creates branches. An `agent` target with `approval: required` pops an
approval modal showing its diff.

## Teams (auth + RBAC + provenance index)

Set `DATABASE_URL` to a Postgres instance and the server switches on accounts,
org/team RBAC, and the Postgres provenance index. Everything else is unchanged;
with no `DATABASE_URL` the server is single-tenant with no auth.

```bash
# 1) a Postgres database (local docker shown; Neon/Supabase/RDS URLs also work)
docker run -d --name makedown-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16

# 2) start the server with auth enabled (schema auto-migrates on boot)
export DATABASE_URL="postgres://postgres:dev@localhost:5432/postgres"
export MAKEDOWN_WORKSPACES_ROOT="$PWD/examples"
export MAKEDOWN_SECURE_COOKIES=1             # set when serving over HTTPS
export MAKEDOWN_ANALYTICS_RATE_LIMIT=120     # optional: analytics reads/min/IP (default 60)
node apps/server/dist/main.js
# → ... (workspaces: .../examples, auth: on)
```

Then in the web app: **create an account** (you get a personal org as `owner`). A
new account starts with no workspaces — the landing screen lists unclaimed
`build.md` workspaces under the server's root; click **+ Add** to bring one into
your org. Roles: a `viewer` reads the graph/artifacts; a `member` can
build/snapshot/branch; an `admin` manages members; the `owner` can delete the org.
Each build's provenance is mirrored into Postgres for cross-workspace cost/usage
queries, while the canonical record stays in the workspace's CAS.

> Auth uses standard primitives but is a young surface: put a rate-limiting reverse
> proxy / WAF in front of any public deployment, and serve over HTTPS so
> `MAKEDOWN_SECURE_COOKIES=1` applies.

## Sharing a compiled artifact

Two ways, depending on whether you want a file or a live link:

```bash
# A) Standalone export — a self-contained HTML file, no server needed.
md build examples/phase1
md share summary examples/phase1                 # → artifacts/summary.md.share.html
md share summary examples/phase1 --provenance    # include model/inputs/cost
md share summary examples/phase1 -o /tmp/out.html
```

**B) Hosted link** — in the web workbench, open a built target, and in the Artifact
tab click **Create link**. Copy the one-time URL (it opens at `/s/<token>` with no
sign-in). Tick **Include provenance** to publish model/inputs/cost too, and
**Revoke** any link to kill it instantly.

Hosted links are durable with no database (a file-backed registry under the
workspaces root); with `DATABASE_URL` set they live in Postgres and require the
`share:create` role (`member`+). The public page renders Markdown through a strict
sanitizer behind a tight CSP — but treat any link as public-to-the-world, and only
share artifacts whose contents (and provenance, if included) are safe to expose.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `MAKEDOWN_WORKSPACES_ROOT` | Directory whose subfolders are workspaces | required |
| `PORT` | Server port | `4000` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Model credentials for chat/agent/eval/map | none (transform-only) |
| `DATABASE_URL` | Postgres URL → enables auth + teams + provenance index | none (single-tenant) |
| `MAKEDOWN_SECURE_COOKIES` | `1` to set the `Secure` cookie flag (HTTPS) | off |
| `MAKEDOWN_ANALYTICS_RATE_LIMIT` | Analytics reads/min/IP | `60` |
| `MAKEDOWN_MARKITDOWN_CMD` | Override the MarkItDown command (e.g. `python -m markitdown`) | `markitdown` |

## End-to-end test (real browser ↔ real server)

The collaborative surface has a Playwright e2e that boots the actual server
(against a throwaway copy of a zero-dependency `transform` fixture — no API key)
plus Vite, then drives Chromium through the full flow. This is the layer that
catches browser↔server integration regressions the unit suite can't see.

```bash
pnpm --filter @makedown/server build      # the e2e launcher imports the built server
pnpm --filter @makedown/web e2e:install   # one-time: download Chromium
pnpm --filter @makedown/web e2e           # boots server + web, runs the specs
```

Visual-regression baselines (`workbench.visual.spec.ts`) are platform-specific and
committed for `chromium-win32`; regenerate them on your platform with
`pnpm --filter @makedown/web exec playwright test workbench.visual --update-snapshots`.
