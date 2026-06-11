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

## Open-core

| Layer | License | Packages |
|---|---|---|
| **Open source** | Apache-2.0 | `engine`, `format`, `cli`, `providers`, `shared` — run a `build.md` fully locally, no cloud dependency. |
| **Commercial** | Proprietary | `sync` (real-time collab), `web` (editor), `apps/server` (hosting, auth, teams). |

The `build.md` format (`SPEC.md`) is an open standard — your graph is never
locked in.

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
│   ├── sync/               # [commercial] CRDT sync server + git backing (placeholder)
│   └── web/                # [commercial] collaborative editor (placeholder)
└── apps/
    └── server/             # [commercial] auth, billing, hosting (placeholder)
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
caps, and `map` fan-out is capped. Remaining: the commercial collaboration layer
(Phase 2). Engine = TypeScript. 195 tests; engine ~95% statement coverage.

## Develop

```bash
pnpm install
pnpm build         # build all packages
pnpm typecheck
pnpm test
```

## License

OSS packages: Apache-2.0 (see [`LICENSE`](./LICENSE)). Commercial packages carry
their own `LICENSE` and are not Apache-2.0.
