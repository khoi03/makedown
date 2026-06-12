# Makedown

> **Make for LLM workflows.** A collaborative Markdown workspace where every
> inference and agent run is a content-addressed, incrementally-rebuilt,
> shareable **build artifact** — literally "GNU Autotools × Notion."

Makedown answers the question Patrick Collison posed: *"there is all this stuff
which I want to process/compute over in this iterated way, with some build
artifacts being important/worth saving."* It treats a directory of Markdown
sources + a `build.md` spec as a **dependency graph**, and only recomputes what
changed.

```bash
md build            # incremental build — only stale targets recompute
md status           # what's stale and why
md graph            # the dependency DAG in execution order
md render <target>  # the exact system + user prompt a target would send — no tokens spent
md why <target>     # full provenance: inputs, prompt, model, params, cost, tokens
md cost             # estimated token/$ upper bound before running (no model calls)
md share <target>   # read-only shareable artifact link (planned)
```

Each target can set a `system:` prompt (or inherit a workspace default); both the
system and user prompts support `{{ref}}` interpolation. Models are chosen per
target via `provider:model` (e.g. `anthropic:claude-opus-4-8`, `openai:gpt-5`),
with keys/base-URLs from a workspace `.env` — so one workspace can compare models
across providers (see `examples/compare`).

## Step types

A target's `step` decides how it computes (see [`SPEC.md`](./SPEC.md) §6):

| `step` | What it does | Tokens |
|---|---|---|
| `chat` | One model inference with the rendered prompt. | yes |
| `eval` | Score/grade an input; with a `schema`, the output must be valid JSON. | yes |
| `map` | Fan a prompt out `over` a list (`{{item}}` per element), collected into one JSON array. | per item |
| `transform` | Run a deterministic workspace script — *"code where code is enough."* | **zero** |
| `agent` | Coding agent (`agent:`) in an isolated `sandbox`, behind an approval gate. | yes |

The `cache` policy is per target: `deterministic` (cached by identity hash),
`stochastic(n=k)` (store k samples, surface variance, consume a "blessed" one), or
`always` (never cached; the default for `agent`).

[`examples/phase1`](./examples/phase1) is a ready-made tour of `chat`/`map`/
`transform`/`eval` + `stochastic`. Without a key, `md build` still runs the
provider-free `transform` targets and defers the model steps:

```
md status examples/phase1
md cost   examples/phase1      # token/$ upper bound, no model calls
md build  examples/phase1      # builds the transform; reports what needs a key
```

[`examples/agent`](./examples/agent) demos the `agent` step: a coding agent runs
in a throwaway `git worktree`, you review its diff at an approval prompt, and the
accepted **unified diff** is written as the artifact (`git apply` it). It needs a
git repo, a key, and `npm install @anthropic-ai/claude-agent-sdk`.

> **Security — `transform`/`agent` run code.** Every declared path (inputs,
> outputs, scripts) is confined to the workspace — `..`, absolute paths, and
> escaping symlinks are rejected. A `transform`'s isolation is set by its
> `sandbox` field: `worktree` (default) runs it in a **locked-down subprocess**
> (no ambient filesystem, no inherited secrets, memory + time caps);
> `container` runs it in **Docker** (also `--network none`, the strongest level);
> `none` imports it in-process like a `make` recipe (trusted escape hatch).
> An `agent` step runs in its `sandbox` (`worktree` default; `none` advisory),
> and `approval: required` gates the artifact — denied output is never written and
> downstream targets are skipped. `map` fan-out is capped to bound runaway
> inference. *(Phase 1.5 hardening — implemented.)*

## Why this exists

Existing tools are prompt registries, flow canvases, or agent control planes.
**None has the `make` layer**: a declarative, content-addressed, incrementally
recomputed dependency graph where LLM/agent outputs are reproducible,
provenance-tracked artifacts. That engine is the whole bet. See
[`PLAN.md`](./PLAN.md) for the full research dossier and roadmap, and
[`SPEC.md`](./SPEC.md) for the `build.md` format.

## Licensing (dual-license)

| Layer | License | Packages |
|---|---|---|
| **Framework** | Apache-2.0 | `engine`, `format`, `cli`, `providers`, `shared`, `agents` — run a `build.md` fully locally, no server or database. Free for any use, including commercial. |
| **Server & collaboration** | AGPL-3.0 | `sync` (real-time collab), `web` (editor), `apps/server` (API, snapshots, and Phase 2.4 auth/teams). Free to self-host and modify under the AGPL. |
| **Commercial exception** | by contract | A commercial license for the AGPL parts is available if you can't comply with the AGPL — see [`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md). |

Full details in [`LICENSING.md`](./LICENSING.md). The `build.md` format
(`SPEC.md`) is an open standard — your graph is never locked in.

## Monorepo layout

```
makedown/
├── SPEC.md                 # the build.md format spec (open standard)
├── PLAN.md                 # research dossier + roadmap
├── packages/
│   ├── shared/             # [OSS] domain types + zod schemas
│   ├── format/             # [OSS] build.md parser / serializer
│   ├── engine/             # [OSS] ★ DAG, content-addressed store, hashing, provenance, sandbox
│   ├── providers/          # [OSS] model adapters (Anthropic first) + cost accounting
│   ├── agents/             # [OSS] coding-agent runner (Claude Agent SDK) for the agent step
│   ├── cli/                # [OSS] the `md` command
│   ├── sync/               # [AGPL-3.0] Yjs CRDT doc model + git backing + WebSocket sync server
│   └── web/                # [AGPL-3.0] React collaborative workbench (editor + DAG + inspector)
└── apps/
    └── server/             # [AGPL-3.0] Fastify API: build orchestration, SSE, snapshots/branches
```

## Status

**Phase 0 (engine spike) + Phase 1 are done.** The headless incremental engine is
proven (edit one source → only affected targets recompute; `md why` shows
provenance; a no-op rebuild costs zero tokens). Phase 1 adds the `transform`,
`eval`, `map`, and `agent` step types, the `stochastic(n=k)` cache policy, real
`md cost` token/$ estimation, and a polished CLI. The `agent` step runs a coding
agent in an isolated `git worktree` behind an approval gate, capturing its diff.
**Phase 1.5 (untrusted-workspace safety) is done:** every path is confined to the
workspace, `transform` scripts run in a locked-down subprocess (or Docker via
`sandbox: container`) with no ambient filesystem/secrets/network and memory+time
caps, and `map` fan-out is capped.

**Phase 2 collab core (2.0–2.3) is done** — the AGPL collaboration layer:
real-time co-editing (Yjs CRDT) of `build.md` + sources, a git-backed snapshot/
branch model, a Fastify server that drives the engine with streaming build
progress (SSE) and a human approval gate, and a React **build workbench**
(collaborative editor + live DAG + artifact/provenance/cost inspector). Remaining:
Phase 2.4 (auth, team RBAC, optional Postgres provenance index, `md share`
published views) — all optional and self-host-first. Engine = TypeScript.
**323 unit/integration tests** + **5 script tests** + a **2-spec Playwright e2e**
that drives a real browser against the real server (open → live-edit → build →
artifact, and two-client sync); engine ~95% / sync ~95% / server ~91% statement
coverage. The dependency-direction guard (`pnpm lint:deps`) keeps the Apache-2.0
framework packages standalone — they never import the AGPL server/collab packages.

## Develop

```bash
pnpm install
pnpm build         # build all packages
pnpm typecheck
pnpm test
pnpm lint:deps     # verify the framework stays standalone (Apache-2.0 pkgs never import the AGPL server/collab pkgs)
```

## Run the collaborative app (Phase 2)

The workbench is two processes: the **server** (Fastify API + sync WebSocket) and
the **web** dev server (Vite, which proxies `/api` + `/sync` to the server).

```bash
# 0) build the workspace packages the server imports
pnpm build

# 1) point the server at a directory whose subfolders are workspaces
#    (each workspace is a git repo with a build.md). Use the bundled examples:
#    examples/quickstart, examples/phase1, ... each already has a build.md.
#    A workspace must be a git repo for snapshots/branches:
git -C examples/quickstart init -q -b main   # once per example, if not already

# 2) start the server (PowerShell shown; bash: MAKEDOWN_WORKSPACES_ROOT=... node ...)
$env:MAKEDOWN_WORKSPACES_ROOT = "$pwd/examples"   # the workspaces root
$env:PORT = "4000"
# optional: model credentials so chat/agent builds actually run
$env:ANTHROPIC_API_KEY = "sk-..."                 # omit for transform-only builds
node apps/server/dist/main.js
# → Makedown server listening on http://127.0.0.1:4000 (workspaces: .../examples)

# 3) in a second terminal, start the web app (proxies to the server above)
pnpm --filter @makedown/web dev
# → open the printed URL (http://localhost:5173). Pick a workspace, or deep-link
#   to one directly: http://localhost:5173/#/quickstart
```

In the workbench: edit `build.md` on the left (open the same URL in two tabs to
see live co-editing + presence cursors); the **DAG** updates as you type; click
**Build** to run — stale targets recompute and stream status onto the graph;
click a node to inspect its **artifact / provenance / cost**; **Snapshot** commits
the current state to git; the branch chip switches/creates branches. An `agent`
target with `approval: required` pops an approval modal showing its diff.

> **Security:** the server has no auth yet (Phase 2.4). Run it locally or on a
> trusted network only — build endpoints execute workspace code (sandboxed per
> Phase 1.5). Don't expose it publicly until 2.4 adds auth + RBAC.

### End-to-end test (real browser ↔ real server)

The collaborative surface has a Playwright e2e that boots the actual server
(against a throwaway copy of a zero-dependency `transform` fixture — no API key)
plus Vite, then drives Chromium through the full flow. This is the layer that
catches browser↔server integration regressions the unit suite can't see.

```bash
pnpm --filter @makedown/server build      # the e2e launcher imports the built server
pnpm --filter @makedown/web e2e:install   # one-time: download Chromium
pnpm --filter @makedown/web e2e           # boots server + web, runs the specs
```

## License

Makedown is **dual-licensed** — see [`LICENSING.md`](./LICENSING.md):

- **Framework** (`engine`, `format`, `cli`, `providers`, `shared`, `agents`):
  **Apache-2.0** (root [`LICENSE`](./LICENSE)). Free for any use, incl. commercial.
- **Server & collaboration** (`apps/server`, `packages/sync`, `packages/web`):
  **AGPL-3.0** (each carries its own `LICENSE`). Free to self-host under the AGPL.
- A **commercial license** for the AGPL parts is available by contract — see
  [`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md).
