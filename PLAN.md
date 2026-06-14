# Makedown — Plan & Research Dossier

> **Working codename:** `Makedown` (= `make` + mark`down`). Telegraphs the whole thesis: a build system whose source files are Markdown. Rename later.
>
> **One-line pitch:** *Make for LLM workflows.* A collaborative Markdown workspace where LLM/agent outputs are first-class, content-addressed, incrementally-rebuilt **build artifacts** in a dependency graph — literally "GNU Autotools × Notion."
>
> **Status:** Plan / pre-build. Saved 2026-06-09 so work can continue in a new session.
> **Origin:** Patrick Collison (Stripe CEO) tweet, 2026-06-07, "I want some kind of LLM workflow tool… GNU Autotools x Notion or something. Is anyone building this?" (272K+ views).

---

## ▶ Resuming in a new session

1. Start the session **inside this directory** (`C:\Users\khoiv\Documents\Code\makedown` — moved out of OneDrive, now git-backed with a GitHub remote). This project has its own auto-memory, so the Makedown notes load automatically.
2. Kick off with: **"Continue Makedown — read `PLAN.md` (§14 = current state) and `SPEC.md`, confirm where we are, then wait."**
3. Expect the assistant to **verify before acting**: `pnpm install && pnpm -r build && pnpm -r test` should be green, then `node packages/cli/dist/index.js status examples/quickstart`.

`PLAN.md` + `SPEC.md` are the durable source of truth (they travel with git); the auto-memory just makes the assistant reach for them unprompted.

---

## 0. The problem (verbatim requirements from the tweet)

Patrick's five bullets — treat these as acceptance criteria:

1. **Manage a set of input files** (Markdown or similar) plus other general-purpose context.
2. **Real-time collaboration**, with some concept of **snapshots or VCS integration**.
3. Ability to **create/manage inference workflows and a stored set of prompts**.
4. Access to **general-purpose coding agents** (not just chat models).
5. Some concept of **compiled outputs / inference results** that can be **shared externally**.

The unifying metaphor — and the part nobody has built — is the **build-system semantics**: *"there is all this stuff which I want to process/compute over in this iterated way, with some build artifacts being important/worth saving."* That's `make`: declarative targets, a dependency DAG, incremental rebuild, reproducibility, content-addressed caching.

---

## 1. Research findings — who has done what (June 2026)

> Evidence type legend: **[F]** sourced fact from web research · **[I]** inference · **[R]** recommendation.

The market splits into five buckets. **No single tool covers all five of Patrick's bullets, and critically none has the build-system core.** [I]

### Bucket A — Prompt management / versioning
| Tool | What it does | Gap vs Patrick |
|---|---|---|
| **Canopy** [F] | Git-native prompt composition (extends/mixins), versioned JSONL, emits `.md` | No build graph, no artifacts, no agents, no collab UI |
| **PromptScript** [F] | Compiles hierarchical prompt registry → `CLAUDE.md`/`.cursorrules`/Copilot, CI validation | Prompt-config compiler only; no inference, no collab |
| **Raison / Langtail / PromptHub / Ordinus** [F] | Prompt CRUD, versioning, RBAC, some visual chaining; Ordinus explicitly *does not execute models* | Registries, not build systems; outputs aren't first-class artifacts |

### Bucket B — Collaborative AI canvases (closest on collab, weak on build)
| Tool | What it does | Gap |
|---|---|---|
| **Kanwas** [F] | Multiplayer board; humans + agent share docs; **git-backed Markdown filesystem**, `kanwas pull` to repo | Freeform canvas; no declarative targets / incremental recompute / artifact cache |
| **Agor** [F] | Figma-style multiplayer canvas orchestrating Claude Code/Codex/Gemini on git worktrees; zones trigger templated prompts | Coding-session canvas; no Make-style dependency graph or content-addressed artifacts |
| **Miriad / Playgram / CharmIQ / Fenix** [F] | Real-time human+agent workspaces, shared memory, skills | Chat/canvas-centric; no build artifacts, no DAG |

### Bucket C — Agent orchestration / control planes (closest on agents + DAG)
| Tool | What it does | Gap |
|---|---|---|
| **Ark** [F] | DAG-based SDLC flows, 5 runtimes, knowledge graph, git worktrees, LLM router, web+desktop | Dev/CLI-centric; imperative pipelines; not a collaborative Markdown doc workspace; no content-addressed artifact cache |
| **Kronn** [F] | Self-hosted control plane; **decompose into deterministic code + small AI steps**; compare-agents; `WORKFLOW.md` | Great "code where code is enough" principle, but imperative workflow engine, not declarative incremental build over Markdown sources |
| **Automaker / HighFlow** [F] | Kanban + Claude Agent SDK; DAG editor + AI operators; local-first | Imperative; outputs are logs, not versioned content-addressed artifacts |

### Bucket D — Workflow / flow builders
**Dify, n8n, promptflow (Microsoft), llm.md** [F] — imperative visual/textual flow builders, run-on-trigger. No incremental content-addressed rebuild; artifacts aren't first-class versioned entities; weak file-centric collab.

### Bucket E — Optimizers (adjacent, different problem)
**Overmind** [F] — autonomously optimizes one Python agent's *quality* via trace-scored experimentation (policy + eval spec + dataset → best agent). Solves "make my agent better," not "orchestrate my workspace's artifact graph." **Candidate future integration, not a competitor.** [I]

### Industry context [F]
- OpenAI acquired **Promptfoo** (~$86M, Mar 2026) → "prompt evaluation is infrastructure."
- **ZenML** versions prompts as immutable pipeline artifacts; **AI21** published a positional content-addressed cache key for agentic pipelines (directly relevant to our cache design).
- **MarkItDown** v0.1.6 (May 2026) — robust any-file → Markdown ingestion (use it for the import path).

### The gap (our wedge) [I]
> Everyone has built **the editor** (Notion-likes), **the flow canvas** (Dify/Agor), **the prompt registry** (Canopy/Raison), or **the agent control plane** (Ark/Kronn). **Nobody has built the `make` layer**: a *declarative, content-addressed, incrementally-recomputed dependency graph* where LLM/agent outputs are reproducible, provenance-tracked, shareable build artifacts — sitting under a collaborative Markdown surface.
>
> Two people replied to Patrick that they're "close" (**Overmind** = typed artifacts but it's an optimizer; an enterprise builder landed on "Slack×Confluence×Figma work-lanes"). **No one named a build-system-semantics product.** [F/I] The wedge is open.

---

## 2. Product thesis & positioning

**Thesis:** The right primitive for iterated LLM work is a **content-addressed, incremental, reproducible build graph** — not another canvas, registry, or imperative flow. Get the `make` core right and the Notion layer sits naturally on top of it.

**Positioning one-liner:** *"`make` for LLM workflows — a collaborative Markdown workspace where every inference and agent run is a cached, versioned, shareable artifact."*

**The defensible moat (in priority order):**
1. **Content-addressed incremental build engine** — only recompute what changed; this is the hard, novel, valuable core. Everyone else re-runs everything on trigger.
2. **Reproducibility & provenance** — every artifact records `hash(inputs + recipe + prompt + model + params)`, cost, tokens, timestamp. `md why <artifact>` explains exactly how it was produced.
3. **Literate build spec** — the "Makefile" *is* a collaboratively-edited Markdown doc (`build.md`). This is the literal "Autotools × Notion."
4. **Determinism policy as a first-class concept** — explicitly model LLM non-determinism (pin/seed/temp, sample-N, re-roll) instead of pretending caching "just works."

---

## 3. Core concepts / data model

- **Workspace** — a git-backed directory of Markdown sources, a `build.md` spec, and a content-addressed artifact store. No vendor lock-in (matches Kanwas/Agor pattern; Patrick wants "VCS integration").
- **Source** — an input file (Markdown/text/CSV/PDF→MD via MarkItDown) or external context (URL, dataset). Hashable.
- **Recipe / Target** — a declarative build rule: `{ name, inputs[], step-type, model, params, output, cache-policy, prompt-body }`. Lives as a block in `build.md`.
- **Step types** — `chat` (single inference) · `agent` (general-purpose coding agent in an isolated worktree → produces code/diffs/files) · `transform` (deterministic code, zero tokens — Kronn's "code where code is enough") · `eval` (score an artifact) · `map` (fan-out a recipe over a list).
- **Artifact** — a compiled output. **Content-addressed** by `hash(resolved-inputs + recipe + model + params)`. Immutable, versioned, provenance-tracked, shareable via URL.
- **Snapshot** — an immutable build state (the whole graph at a point in time). Branchable, diffable. Git-native.
- **Build** — running the engine: resolve DAG → detect stale targets → recompute only those → write artifacts + provenance.

---

## 4. The `build.md` format (literate Makefile)

A Markdown doc whose fenced target blocks define the graph. This is the product's signature artifact.

````markdown
## target: market-summary
```yaml
inputs: [sources/raw-notes.md, sources/prices.csv]
step: chat                       # chat | agent | transform | eval | map
model: claude-opus-4-8
params: { temperature: 0, seed: 7 }
output: artifacts/market-summary.md
cache: deterministic             # deterministic | stochastic(n=3) | always
```
Summarize the trading notes in {{sources/raw-notes.md}} using the price
series in {{sources/prices.csv}}. Output a 5-bullet executive summary.

## target: refactor-pr
```yaml
inputs: [market-summary, sources/spec.md]   # depends on another TARGET + a source
step: agent
agent: claude-code
sandbox: worktree
output: artifacts/refactor.diff
cache: always                    # agent runs are non-deterministic; gate with approval
approval: required
```
Using the summary {{market-summary}} and {{sources/spec.md}}, implement the
change in an isolated worktree and emit a diff.
````

**CLI surface** (the `make` UX):
- `md build` / `md build <target>` — incremental build (only stale targets)
- `md status` — what's stale and why (which input hash changed)
- `md graph` — render the DAG
- `md why <artifact>` — full provenance (inputs, prompt, model, params, cost, tokens)
- `md cost --dry-run` — estimate token/$ cost before running
- `md share <artifact>` — produce a read-only shareable link
- `md snapshot` / `md diff <a> <b>` — VCS operations

---

## 5. Build engine design (the moat — get this right first)

**Incremental recompute:** topological sort the DAG; a target is **stale** iff `hash(resolved inputs + recipe text + model id + params)` differs from the stored artifact's hash. Only stale targets (and their downstream) recompute. This is the cost-saving, latency-saving, "feels like magic" core. [R: build this before any UI]

**Content-addressed store (CAS):** artifacts keyed by their composite hash on disk (`.makedown/cas/<hash>`), with a metadata index (SQLite local / Postgres cloud). Borrow AI21's **positional cache key** idea so reordering the graph doesn't spuriously invalidate. [F]

**Determinism policy (first-class):**
- `deterministic` — pin `temperature: 0` + `seed`; cache aggressively; reuse provider prompt-caching.
- `stochastic(n=k)` — store k samples as sibling artifacts; surface variance; let user pin a "blessed" sample.
- `always` — never cache (typical for `agent` steps); require `approval` gate.

**Provenance record per artifact:** input hashes, resolved prompt, model+version, params, token counts, $ cost, wall-clock, timestamp, producing user/agent. Powers `md why`, reproducibility, and cost analytics.

**Parallelism:** independent targets run concurrently (thread/worker pool; isolate agent runs in worktrees/containers — Ark/Agor pattern). [F]

**Engine boundary:** keep the engine a pure, headless library with a clean API so it can later be ported TS→Rust (Ark/Kronn went Rust for perf). Start TypeScript for velocity. [R]

---

## 6. Collaboration & VCS layer (the "Notion")

- **Real-time co-editing** of sources and `build.md` via CRDT (**Yjs** or Automerge) + a sync server; presence, cursors, comments. [R]
- **Git-native backing** — the workspace *is* a git repo of Markdown + a CAS; snapshots map to commits; branches enable "try a different prompt graph"; artifacts are diffable. Gives Patrick's "snapshots / VCS integration" for free and avoids lock-in. [R]
- **Conflict handling** spans two layers: CRDT for doc text, git-style merge for the build graph + artifacts.

---

## 7. Agents as a step type (not just chat)

- `step: agent` runs a **general-purpose coding agent** (Claude Agent SDK; pluggable Codex/Gemini later) in an **isolated git worktree/container**, producing artifacts (diffs, files, code) that re-enter the graph as inputs to downstream targets. [F: Automaker/Ark/Agor all do worktree isolation]
- **Approval gates** (`approval: required`) before agent artifacts are accepted — human-in-the-loop, like Kronn's Gate / Ark's verification gates. [F]
- **"Code where code is enough"** — the `transform` step type runs deterministic code at zero token cost; reserve LLM/agent steps for genuine reasoning (Kronn's désagentification discipline). [F]

---

## 8. Sharing / publishing compiled outputs

- Every artifact has a stable content-addressed URL; `md share` issues a **read-only published view** (rendered Markdown, or interactive via a Sandpack-style renderer for code artifacts — Agor pattern). [F]
- Published artifacts carry optional provenance ("produced from these inputs by this model") — trust + reproducibility as a feature.
- Embeddable snippets for external sharing (Patrick's bullet 5).

---

## 9. Architecture & stack (recommended)

**Shape:** web-first cloud app (real-time collab is core) **+** local CLI **+** git backing. Local-first-with-sync, lock-in-free.

**Monorepo (pnpm workspaces):**
```
makedown/
├── packages/
│   ├── engine/        # ★ headless build engine: DAG, CAS, hashing, provenance, determinism (TS; Rust-portable)
│   ├── format/        # build.md parser/serializer (target blocks ↔ AST)
│   ├── providers/     # Anthropic/OpenAI/… adapters + LLM router + cost/token accounting
│   ├── agents/        # coding-agent runner (Claude Agent SDK) + worktree/container sandbox
│   ├── sync/          # Yjs CRDT sync server + git backing
│   ├── cli/           # `md` commands (build/status/why/graph/cost/share/snapshot)
│   ├── web/           # React app: collaborative Markdown editor + DAG view + artifact viewer
│   └── shared/        # types, schemas (zod), IPC/protocol
├── apps/
│   └── server/        # API + sync + CAS index (Postgres) ; or desktop (Electron) shell later
└── examples/          # sample workspaces (build.md demos)
```

**Storage:** git repo (sources + `build.md`) · CAS on disk/object-store (artifacts) · SQLite (local) / Postgres (cloud) for the metadata/provenance index.

**Key libs:** Yjs (CRDT), zod (schema/validation at boundaries — house rule), Claude Agent SDK (agents), MarkItDown (any-file→MD import), a DAG/topo lib, provider SDKs.

> Note: user's environment is Windows + has shipped Electron+React+Python desktop apps before. An Electron desktop shell wrapping `web/` is a viable secondary target (Ark/PromptHub pattern), but **start web** because collaboration is the core requirement.

---

## 10. Phased roadmap

### Phase 0 — Spike the engine (proves the thesis) · **Complexity: HIGH**
- `format` parser for `build.md` target blocks → AST.
- `engine`: DAG resolution, composite hashing, CAS, incremental stale-detection, provenance records.
- `providers`: one provider (Anthropic), `chat` + `transform` step types.
- `cli`: `build`, `status`, `why`, `cost --dry-run`.
- **Exit criteria:** editing one source re-runs only the affected targets; `md why` shows full provenance; re-running with no changes does zero inference. *This is the whole bet — validate it before building UI.*

### Phase 1 — Determinism + agents + sharing · **Complexity: HIGH**
- Determinism policies (`deterministic` / `stochastic(n)` / `always`), sample storage, re-roll.
- `agent` step type w/ worktree sandbox + approval gates; `eval` + `map` step types.
- `md share` → read-only published artifact view.

### Phase 2 — Collaboration & VCS · **Complexity: MEDIUM–HIGH**
- Web app: collaborative Markdown editor (Yjs) + live DAG view + artifact viewer.
- Git-native snapshots/branches; artifact diffing; presence/comments.

### Phase 3 — Polish & moat-deepening · **Complexity: MEDIUM**
- ✅ Cost analytics dashboard (done 2026-06-14 — see §14). ✅ LLM router (multi-provider fallback + cost-aware routing, done 2026-06-15 — see §14). MarkItDown import pipeline.
- Optional: Overmind-style optimizer as an `optimize` step; templates/marketplace of `build.md` recipes.

---

## 11. Risks & mitigations

| Risk | Sev | Mitigation |
|---|---|---|
| LLM non-determinism breaks naive caching | **HIGH** | Determinism policy is first-class (§5); positional cache key (AI21); sample-N + blessed-sample |
| "It's just a workflow builder" (commoditized — some replies dismissed Patrick's idea) | **HIGH** | Lead with the build-engine moat (incremental + content-addressed + provenance), not the canvas |
| Engine complexity / scope creep | **HIGH** | Phase 0 is engine-only, headless, no UI; clean API boundary; ship CLI before web |
| Collab + git merge conflicts on graph state | MED | CRDT for text, git merge for graph; serialize artifacts deterministically |
| Agent sandbox security (arbitrary code) | MED | Worktree/container isolation, approval gates, secrets vault, allow-listed exec |
| Incumbents (Ark/Kronn/Agor) add build semantics | MED | Move fast on the engine; reproducibility+provenance UX is hard to copy well |
| Cost of running many targets | MED→advantage | Incremental rebuild *reduces* cost; expose `cost --dry-run` as a feature |

---

## 12. Differentiation matrix (defend in every pitch)

| Capability | Makedown | Ark/Kronn | Agor/Kanwas | Dify/n8n | Canopy/Raison | Overmind |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Declarative **incremental** build (recompute only stale) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Content-addressed** artifacts + provenance | ✅ | ~ | ❌ | ❌ | ~ | ~ |
| Reproducibility (`why`, pinned model/params) | ✅ | ~ | ❌ | ❌ | ~ | ✅ |
| Markdown sources + collaborative editing | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Real coding agents as a build step | ✅ | ✅ | ✅ | ~ | ❌ | ~ |
| Git-native snapshots/branches | ✅ | ~ | ✅ | ❌ | ✅ | ~ |
| Shareable compiled outputs | ✅ | ~ | ~ | ~ | ❌ | ✅(console) |
| **All five of Patrick's bullets** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

(✅ strong · ~ partial · ❌ absent — per §1 research)

---

## 13. Resolved decisions (2026-06-09)

1. **Engine language → TypeScript.** Headless, clean API boundary so it can be ported to Rust later if perf demands. Same language as CLI + web; Claude Agent SDK is TS-native.
2. **Primary surface → Web-first cloud + CLI.** Real-time collab is a core requirement and hardest in desktop. Local-first-with-sync (git-backed) to avoid lock-in. Phase 0 remains a headless CLI engine spike.
3. **Positioning → ~~Open-core~~ Dual-license** *(superseded 2026-06-12 — see §15 pivot)*. ~~OSS the engine + format + CLI, monetize cloud collaboration/hosting/team features.~~ Now: **all code is open source** (Apache-2.0 framework + AGPL-3.0 server/collab); monetize **commercial exceptions** to the AGPL, not withheld code or in-app billing. *See §15.*
4. **Brand → keep `Makedown` as working name** through Phase 0; defer final branding/trademark until the engine spike proves the concept.
5. **CRDT → Yjs** (default; larger ecosystem). Phase 2, revisit if Automerge's git-like merge fits better.
6. **Phase 0 providers → Anthropic-only.** Add others via the `providers` adapter layer later.

## 15. Licensing model + the engine-standalone discipline

> **Pivot (2026-06-12): open-core → dual-license.** The original plan kept the
> collab/server layer *proprietary* and sold it (open-core). That was abandoned
> in favor of **dual-licensing** (Dify/PostHog/Grafana-style): **all code is open
> source**, and revenue (if any) comes from selling **commercial exceptions** to
> the copyleft license — not from withholding code or from in-app billing. The
> trigger: maximize adoption while the category wedge is still open, and avoid the
> effort/cost of running hosting + billing. **Billing is dropped from the roadmap.**
> Canonical details live in [`LICENSING.md`](./LICENSING.md) + [`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md).

| Layer | License | Package(s) | Rationale |
|---|---|---|---|
| **Framework** | **Apache-2.0** (patent grant > MIT for a format/spec) | `engine`, `format`, `cli`, `providers`, `shared`, `agents` | Drives adoption; the `build.md` format must be an **open spec** so the graph isn't lock-in. Free for any use, incl. commercial. |
| **Server & collaboration** | **AGPL-3.0** + sold commercial exception | `sync` (CRDT server + git backing), `web` (collab editor), `apps/server` (auth, team RBAC, shared artifact views) | Open + self-hostable for everyone; the AGPL stops a hyperscaler from taking the hard hosted-collab part closed-source as a competing SaaS without contributing back (or buying a commercial license). |

**Implications:**
- The **Apache-2.0 framework must run fully standalone** (local CAS + SQLite, no server/DB) — a great solo/CI experience is the top-of-funnel. This is now an **architectural** discipline (keep the engine dependency-light), no longer a *license* boundary.
- The framework packages **never import** the AGPL server/collab packages; enforce with the dependency-direction lint (`scripts/check-deps.mjs`, `pnpm lint:deps`). The lint survives the pivot — its rationale is re-stated as "engine stays standalone," not "OSS can't import proprietary."
- `build.md` format keeps its own versioned **SPEC.md**.
- Single monorepo, **per-package `LICENSE`**: root `LICENSE` = Apache-2.0 (framework); each AGPL package ships the AGPL-3.0 text. Dual-licensing requires the maintainer to hold relicensing rights over contributions (CLA if/when contributors arrive — noted in `LICENSING.md`).
- **AGPL is effectively one-way once published**: a shipped release stays AGPL. Future versions can still be relicensed by the copyright holder, but published bytes can't be clawed back.

---

## 14. Progress & next steps

> §13 decisions are **resolved** (TS · web+CLI · open-core · Yjs · Anthropic-only · keep name).

### Done (2026-06-09)
- ✅ **Monorepo scaffolded** with the open-core split (§15). Installs, `pnpm -r build` + `typecheck` green.
- ✅ **`SPEC.md`** written (the open `build.md` standard).
- ✅ **Phase 0 engine** built and proven: content-addressed hashing, `LocalCas`, DAG topo-sort, incremental stale-detection, provenance. Verified on `examples/quickstart` — edit one source → only affected targets recompute; no-op rebuild = zero inference.
- ✅ **Anthropic provider wired** — `md build` runs `chat` targets end-to-end (writes artifacts to disk + CAS + provenance). Param mapping handles the Opus 4.8/4.7 reality: `temperature`/`top_p`/`top_k`/`seed` are **not** sent (they 400 on Opus); they remain in the identity hash as intent. Pricing table confirmed ($5/$25 per 1M for Opus 4.8).
- ✅ **Multi-provider + `.env`**: workspace `.env` loading (Node `process.loadEnvFile`, zero deps); a `Provider` **router** dispatches on `provider:model` syntax; native Anthropic + an **OpenAI-compatible** adapter (`fetch`-based — OpenAI, OpenRouter, Groq, Together, Ollama, vLLM, LM Studio). Side-by-side model comparison via one-target-per-model (see `examples/compare`). Config: `ANTHROPIC_API_KEY`/`_BASE_URL`, `OPENAI_API_KEY`/`_BASE_URL`, `MAKEDOWN_DEFAULT_PROVIDER`.
- ✅ **System prompts + `md render`**: targets (and front-matter defaults) accept a `system:` field; both system and user prompts support `{{ref}}` interpolation and are part of the identity hash. `md render <target>` prints the exact system + user prompt a target would send — no model call, no tokens — with unbuilt dependency artifacts shown as placeholders.
- ✅ **Tests + coverage**: 46 tests. Coverage — engine ~99% / providers ~92% / format ~89% statements (all >80%).

### Done (Phase 1 — 2026-06-09, TDD)
- ✅ **`transform` step** — deterministic, zero-token. A workspace-authored ES module (default or named `transform` export) runs over resolved input contents; its content folds into the identity hash (via `auxHashes`) so editing it rebuilds. Trusted code (in-process import), documented in SPEC §6 / README; `sandbox` enforcement is future.
- ✅ **`eval` step** — shares the model-call path, records `step: eval`; with a declared `schema`, output must be valid JSON (full JSON-Schema conformance deferred, SPEC §11).
- ✅ **`map` step** — fans `over` a list (JSON array or newline-delimited), one call per item with built-in `{{item}}` bound, collected into one JSON-array artifact; tokens/cost summed. Parser validates `over` is present and declared in `inputs`.
- ✅ **`stochastic(n=k)` cache** — CAS stores up to k sibling samples under one identity hash; stale until k exist (tops up only missing samples after an interruption); a blessed pointer (default 0) materializes the canonical artifact downstream targets consume. Parser rejects stochastic on non-model steps and n<1.
- ✅ **Real `md cost`** — headless `estimateBuildCost`: input tokens from rendered prompts (~4 chars/token), output = `max_tokens` upper bound, priced via the provider table; per-target table + upper-bound total over stale model targets; unknown models flagged.
- ✅ **Aesthetic CLI** — dependency-free ANSI styler (NO_COLOR/FORCE_COLOR/TTY aware) + pure string renderers (separated from IO for testability). `md why` now shows step, cache policy, stochastic sample counts, short input hashes, duration. `md build` builds provider-free `transform` targets even with no key and clearly defers the model steps. `examples/phase1` is a ready-made tour of all Phase 1 features.
- ✅ **Refactor** — extracted `template.ts` (interpolation/list parsing) and `cost.ts` from `build.ts` (775→529 lines). **105 tests**; engine ~96% / CLI ~80% statement coverage. Reviewed (code-review + verification-loop + source security pass): no CRITICAL/HIGH; transform code-execution trust model documented.

- ✅ **Live smoke-test (2026-06-10)** — ran `examples/phase1` end-to-end against a live API (`cc/claude-sonnet-4-6`) from a clean copy: all 4 targets built live (`map` ×3, `stochastic(n=3)` chat → 3/3 samples, `eval` returned valid `{score,rationale}` JSON, `why` showed full provenance); no-op rebuild reused all 4 (0 calls); reverting a source to identical bytes returned all to `fresh` (content hash, not mtime); editing only the transform script staled just `topic-list`+`blurbs`. The real-money `.env → router → adapter → model → CAS` path is verified.

### Done (Phase 1 — `agent` step · Phase 1 now feature-complete · TDD)
- ✅ **`agent` step.** A general-purpose coding agent runs as a build step, in an **isolated git worktree** by default, behind a **human-in-the-loop approval gate**. Mirrors the proven `Provider` injection: the engine depends only on an injected **`AgentRunner` interface** (new OSS package `packages/agents`, Apache-2.0); the real **`ClaudeCodeAgentRunner`** wraps `@anthropic-ai/claude-agent-sdk`, dynamic-imported by name so it's an optional workspace-installed dep — absent ⇒ actionable install hint, not a stack trace.
- ✅ **Sandbox** (`engine/src/sandbox.ts`): `worktree` = detached `git worktree add HEAD` (real throwaway checkout, torn down after; cleanup never throws); `none` = run in workspace (advisory, trusted `build.md`); `container` = `NotImplementedError` (Phase 1.5). `SandboxHandle.diff()` captures the agent's changes (`git add -A && git diff --cached`, 64 MB cap).
- ✅ **Approval gate**: `approval: required` artifacts are accepted only on explicit approval via the injected `ctx.approve`; **no approver ⇒ deny** (safe default). Denied output is never written to disk/CAS, and downstream targets that depend on it are skipped (surfaced as `rejected` in `BuildResult`). CLI wires an interactive TTY approver (non-TTY ⇒ deny).
- ✅ **Artifact = the agent's actual work (the worktree diff)**, falling back to the agent's text when there's no diff. Parser: `step: agent` requires an `agent:` id; agent targets default `cache: always`. `examples/agent` outputs `implement.diff` (`git apply` it). Provenance records `step: agent`, runner tokens/cost, `producedBy`.
- ✅ **Tests**: **147 tests** (agents 4, format 10, providers 18, engine 72, cli 43). Reviewed (code-review + verification-loop + security-scan): no CRITICAL/HIGH; the agent path runs `execFile` with argv arrays (no shell), tears the sandbox down in `finally`, and defaults approval to deny.

> **Note (2026-06-11): repository moved out of OneDrive.** OneDrive sync corrupted
> the prior local `.git` and rewound the working tree, losing the original
> `agent`-step commits (no remote → unrecoverable). The repo now lives at
> `C:\Users\khoiv\Documents\Code\makedown` with a GitHub remote; the `agent` step
> above is the faithful TDD re-implementation. Lesson: keep git repos out of OneDrive
> and push to a remote early.

### Done (Phase 1.5 — untrusted-workspace hardening · 2026-06-11, TDD)
- ✅ **Path-traversal guard** (`engine/src/paths.ts`). Every declared path — inputs, `output`, `transform` scripts, `over` lists — is confined to the workspace root: absolute paths (POSIX **or** Windows form), `..` escapes, NUL bytes, and escaping symlinks are rejected (`realpath` check on the deepest existing ancestor) before any read/write. Wired into `build.ts` + `template.ts` at the IO boundary.
- ✅ **Locked-down `transform` execution.** The `sandbox` field now selects transform isolation: `worktree` (new default) runs the script in a **forked Node child under `--permission`** — no ambient filesystem, **scrubbed env** (the parent's API keys are not inherited), `--max-old-space-size` memory cap, and a wall-clock cap that SIGKILLs an overrun; inputs go over stdin, the result returns over a dedicated fd 3 (immune to the script's stdout). `none` = trusted in-process (escape hatch). The permission model doesn't gate network — that's what `container` is for.
- ✅ **`container` sandbox (Option A).** `sandbox: container` runs the transform in **Docker**: `--network none` (closes the network gap), only the script mounted read-only, `--memory`/`--cpus`/`--pids-limit`/`--read-only` caps, force-removed on timeout. Docker is an **optional** dependency, touched only on this path; `isDockerAvailable()` probes daemon + local image (no network pull), and missing-CLI/daemon-down/missing-image all give actionable errors. Verified live against `node:lts-alpine` (incl. the real network block). Agent-in-container deferred (needs a containerized agent runner — documented).
- ✅ **`map` fan-out cap** (`DEFAULT_MAP_FANOUT_CAP = 1000`, overridable via `BuildContext.maxMapFanout`). An over-cap list fails fast — zero provider calls — naming the target, count, and cap.
- ✅ **Reviewed (code-review + verification-loop + security-scan).** Two real issues caught and fixed: the subprocess inherited the parent env (API-key exposure) → env scrubbed; a comma in a sandboxed script path made the `--allow-fs-read` allow-list ambiguous → rejected. No CRITICAL/HIGH outstanding. **195 tests** (engine 72 → 120), engine ~95% statement coverage. All `spawn`/`execFile` use argv arrays (no shell).

### Done (Phase 2 collab core — 2.0–2.3 · 2026-06-11, TDD)
- ✅ **Engine `onProgress` hook** — an optional, observational `BuildContext.onProgress(event)` emits per-target lifecycle events (`target-start`/`built`/`reused`/`denied`/`skipped`) from `runBuild` so the cloud server can stream build progress over SSE without polling. Additive, stays Apache-2.0.
- ✅ **Open-core boundary guard** (`scripts/check-deps.mjs`, `pnpm lint:deps`) — fails the build if any OSS package imports `@makedown/{sync,web,server}`. Enforces §15 mechanically (was unenforced); pure core unit-tested.
- ✅ **`packages/sync`** (commercial, Yjs CRDT) — the §6 boundary made real: **CRDT for live text** (build.md as a `Y.Text`, sources as a `Y.Map<path,Y.Text>`), **git for snapshots** (materialize the live doc → working tree → commit; branches isolate prompt-graph variants; switching reloads the doc). A transport-agnostic **WebSocket sync server** (y-websocket protocol: sync + awareness/presence, room-per-workspace, lazily-reaped registry) with a thin `ws` adapter. `WorkspacePersistence` debounce-materializes edits to disk so the engine always builds fresh text without committing per keystroke. **33 tests, 94.9% stmt coverage.**
- ✅ **`apps/server`** (commercial, Fastify) — drives `@makedown/engine` exactly like the CLI's `makeContext` (server CAS, provider router, agent runner). `BuildManager` runs builds **off-request**, captures `onProgress` for **SSE** (with replay for late subscribers), and **bridges the engine's `approve` callback** to an HTTP-resolvable pending-approval registry (deny on timeout/job-end). REST surface: graph (`planBuild`), cost, build + events, artifacts + `why`, git snapshots + branches, approval resolve. `main.ts` assembles per-workspace live docs + persistence and **mounts the sync WS on the same HTTP server**. **45 tests, 91% stmt coverage** (incl. a real-socket e2e).
- ✅ **`packages/web`** (commercial, React + Vite) — a three-pane **collaborative build workbench**: a CodeMirror 6 editor bound to the shared `Y.Text` via `y-codemirror.next` with awareness cursors; a live **React Flow DAG** with status-badged nodes (pure layered layout); an inspector (artifact / provenance / cost) fetched per selection; a toolbar (build, snapshot, branch, presence) with an SSE build stream and an approval modal; a hash-routed workspace picker. Intentional dark "build-workbench" design system (not a template). The heavy editor/graph/CRDT stack is **lazy-loaded** so the landing route is ~5 kB gzip; vendors are split into cacheable chunks. **36 tests** (pure logic + component behavior).
- ✅ **Reviewed (code-review + verification-loop + security-scan).** Three real issues caught and fixed: a crafted WS URL could throw in the `connection` handler and **crash the server** (now caught → close 1008); per-workspace doc/persistence maps **leaked** on room dispose (now flushed, destroyed, and dropped); an **unvalidated branch name** reached `git checkout` (argument injection — `git checkout .` discards changes) → `assertValidBranchName` + HTTP 400. Clean on secrets, XSS (React-escaped), `eval`, path-safety, and git-via-argv. **All monorepo tests green: 314 package + 5 script = 319.**

> **Security note:** by default (no `DATABASE_URL`) the server is **single-tenant with no auth** — run it locally / on a trusted network only (build endpoints execute workspace code, sandboxed per Phase 1.5). **Phase 2.4a adds optional auth + team RBAC** (set `DATABASE_URL`); for a public deployment also front it with a rate-limiting proxy/WAF and serve over HTTPS (`MAKEDOWN_SECURE_COOKIES=1`).

### Post-merge hardening (live-testing fixes + e2e · 2026-06-12)
Running the app by hand surfaced **7 browser↔server integration bugs the unit suite missed** — all now fixed, each with a regression test:
1. `ApiClient` called the global `fetch` as a method → `this`-binding lost → "Illegal invocation" on every request. Bind to `globalThis`.
2. Vite's `/sync` ws proxy was unreliable (`ECONNABORTED`/`ECONNRESET`); connect the collab WebSocket **directly to the server** in dev (`__SYNC_ORIGIN__`), HTTP `/api` still proxied.
3. **CRDT content duplication:** loading build.md *text* into a fresh Y.Doc on every room (re)creation is a Yjs anti-pattern (merges ops, not states) → content compounded to **megabytes** → parse failed. Fix: persist/restore the encoded **CRDT state** (`.makedown/sync/ydoc.bin`) so reopens/restarts keep one stable history; restore-before-text-reconcile.
4. `server.close()` leaked the per-workspace persistence debounce timers (post-shutdown writes / `ENOTEMPTY`). Add `dispose()`.
5. **Build 500:** bodyless `POST /build` was sent with `content-type: application/json` + empty body → Fastify `FST_ERR_CTP_EMPTY_JSON_BODY` masked as 500. Client omits the header when bodyless; server tolerates empty JSON bodies + honors framework 4xx codes.
6. **React `StrictMode`** double-bound the CodeMirror editor to the shared `Y.Text` (dev double-invoke) → doc doubled. Removed `StrictMode`.
7. WS handler hardening + branch-name validation (from the pre-merge review/security pass).
- **Hardening added:** a **Playwright e2e** (`packages/web/e2e`) that boots the real server (temp copy of a zero-dep `transform` fixture, no API key) + Vite and drives Chromium through open → live-edit → build → artifact, plus two-client sync + a no-duplication assertion. This is the layer that would have caught #1, #3, #5, #6 automatically.
- **Verified working end-to-end by the user (2026-06-12)** after a clean-slate reset. All green: **323 package + 5 script tests + 2 e2e specs**.
- Known residual sharpness (not blocking): the text↔CRDT hybrid can still duplicate if a *stale* browser tab holding a divergent doc reconnects; a clean start is stable. A future option is making the persisted CRDT state the sole source of truth (deriving text only for the engine/git).

### Done (Phase 2.4a — tenancy foundation · 2026-06-12, TDD · AGPL-3.0)
> Re-scoped under the dual-license pivot (§15): **billing dropped**; auth/RBAC/Postgres are **optional + self-host-first**. The whole layer is **inert unless `DATABASE_URL` is set** — with no DB the server runs exactly as before (the regression gate: every pre-2.4 test passes byte-for-byte under `NullTenancy`).
- ✅ **The optional-tenancy seam** (`apps/server/src/tenancy/`). A `TenancyProvider` interface with two impls injected like the existing provider/agent-runner pattern: **`NullTenancy`** (no DB → permissive single-tenant passthrough, today's behavior) and **`TenancyService`** (DB → real auth/RBAC). The HTTP layer calls the same methods regardless; `enabled` lets it skip the login wall + per-request authz entirely. The engine and all framework packages never learn tenancy exists (`lint:deps` enforced).
- ✅ **Auth on Node `crypto` only** (`auth.ts`, no external auth vendor, minimal-dep ethos) — scrypt password hashing (per-user salt, constant-time verify that never throws on bad input), 256-bit CSPRNG session tokens **stored only as a SHA-256 hash** (a DB leak isn't a usable token), session expiry, fresh token per login (no fixation). HttpOnly + SameSite=Lax (+ Secure in prod) session cookie (`cookies.ts`). Login/signup **rate-limited** (fixed-window per IP, `rate-limit.ts`). No user enumeration (dummy-KDF on unknown user; generic 401/409). *Chose lean standard-primitive auth over `better-auth` for full in-process testability + the codebase's near-zero-dep ethos; swappable behind the interface.*
- ✅ **RBAC** (`rbac.ts`) — strict `viewer ‹ member ‹ admin ‹ owner` hierarchy as a pure `can(role, action)`; every workspace/job route guarded by the right action (`ensureAuthorized`/`ensureJobAccess`), default-deny.
- ✅ **Repository-pattern store** (`store.ts`) — `InMemoryTenancyStore` (tests/small self-host, fully tested) + **`DrizzleTenancyStore`** (Postgres). The adapter is verified in CI against **pglite** (real Postgres compiled to WASM, in-process — no Docker/network). Schema + idempotent DDL co-located (`drizzle/schema.ts`); `postgres-js` connector auto-migrates on boot (`drizzle/postgres.ts`).
- ✅ **Provenance dual-write** (`provenance-index.ts`) — after a build the server projects the built targets' CAS provenance into a denormalized PG **index** (re-derivable, never the source of truth; no-op under `NullTenancy`). The engine's CAS writes are untouched → the boundary holds.
- ✅ **HTTP surface** — `/api/auth/{signup,login,logout,me}`, `/api/tenancy` capability probe, `/api/orgs` + register-workspace; session `preHandler`; tenant-scoped workspace listing.
- ✅ **Web** (`packages/web`) — an `AuthGate` that is **invisible when tenancy is off** (probes `/api/tenancy`; older server ⇒ fail-open to no-auth) and otherwise interposes an editorial sign-in/sign-up screen + account chip, reusing the dark build-workbench tokens (not a template). `ApiClient` sends the session cookie (`credentials: include`).
- ✅ **Reviewed (code-review + security review against OWASP/security.md) + verified.** One real gap found and **fixed** (no rate limiting on auth → added the limiter). Clean on injection (parameterized Drizzle), secret exposure (hash never serialized), CSRF (SameSite), enumeration, and the framework boundary. Documented (not defects): per-request session DB lookup (future cache); workspace registration is first-come in a shared root (future admin-assign). **All green: 398 package + 5 script + 2 e2e** (server 46 → 117).

### Done (Phase 2.4b — sharing · 2026-06-13, TDD · Apache-2.0 CLI + AGPL-3.0 server/web)
> Read-only published views of compiled artifacts, split along the license boundary into two complementary tracks (the framework stays standalone; the always-on hosted component owns capability URLs). *No billing — §15.*
- ✅ **`md share <target>`** (CLI, Apache-2.0, **standalone**) — exports a built artifact to a **self-contained HTML file** (no server, no DB, no token). Reads the artifact from the local CAS by identity hash (stale/unbuilt → actionable error, never a blank export); renders it as **escaped preformatted text** (zero new deps, zero XSS), `--provenance` to include model/inputs/cost, `-o` to choose the path. `lint:deps` stays green — the CLI never imports the server.
- ✅ **Hosted share links** (`apps/server`, AGPL) — a `SharingService` over a repository-pattern `ShareStore`: tokens are **256-bit CSPRNG, stored only as a SHA-256 hash** (reusing the tenancy auth primitives), revocable, optionally-expiring (clamped ≤365d). Three store impls behind the seam: in-memory (tests), **file-backed** (`<root>/.makedown-shares.json`, atomic temp-rename, single-writer chain → durable with **no DB**), and **Drizzle/Postgres** (pglite-verified, same connection as tenancy). Sharing is **not** gated on `DATABASE_URL` — it works in both modes; `share:create` (member+) authorizes minting under tenancy, permissive under `NullTenancy`.
- ✅ **Public `/s/:token` route** (the most-exposed surface, hardened in layers) — Markdown artifacts rendered via `marked` → **`sanitize-html` allow-list** (no `<script>`, no event handlers, no `javascript:`/`vbscript:` URLs); non-Markdown rendered as **escaped `<pre>`**; every interpolated value escaped. Served with a strict **CSP** (`default-src 'none'`, no scripts, `frame-ancestors 'none'`), `nosniff`/`no-referrer`/`X-Frame-Options: DENY`, a **uniform HTML 404** for unknown/revoked/expired (no oracle), and a **per-IP rate limiter** (configurable). Provenance is **opt-in per link** (and even then excludes the resolved prompt/params). An `ArtifactStore`/CDN seam is left for later (local CAS today).
- ✅ **Web** — a **Share panel** in the artifact inspector: mint a link (token shown **once** → prominent copy), tick "Include provenance", list live links, **Revoke**. Reuses the dark build-workbench tokens; permission errors surface inline (not silently). Dev: Vite now proxies `/s/` (trailing slash is load-bearing — a bare `/s` shadows the `/sync` WS).
- ✅ **Reviewed (code-review + verification-loop + security-scan) + verified.** Clean on secrets, injection (parameterized Drizzle), XSS (sanitizer + escaped-pre, tested with `<script>`/`onerror`/`javascript:`), token guessing (CSPRNG + hash-at-rest + uniform 404 + rate-limit), and the framework boundary. Low/info notes (non-blocking): public Markdown permits `https:` images (inherent external fetch on view; CSP limits to `img`); a corrupt registry file recovers to empty silently; no response-size cap on huge artifacts. **All green: 442 package + 5 script + 3 e2e** (server 117 → 151; the new e2e drives build → mint → public view → revoke 404).

### Done (Phase 3 — cost analytics dashboard · 2026-06-14, TDD · AGPL-3.0 server/web)
> The first **reader** of the provenance index dual-written in 2.4a (until now write-only). Surfaces cross-workspace spend/token/usage, behind the tenancy seam: team mode reads Postgres; single-tenant shows a graceful empty state. *No billing — §15.*
- ✅ **Store-layer aggregation** (`tenancy/analytics.ts`, both stores) — a repository-pattern `aggregateProvenanceForOrg(orgId, range?)` returns totals + breakdowns by **workspace / model / target / day** over a half-open `[from,to)` window. `InMemoryTenancyStore` reduces in TS; `DrizzleTenancyStore` pushes **four indexed `GROUP BY`s + one totals scan** into Postgres (so the row set is never materialized) — `GROUP BY` by output-ordinal to survive Drizzle rendering the key expr differently in SELECT vs GROUP BY; `coalesce(model,'(none)')`; bigint/numeric aggregates string-coerced; costs `round6`'d for float-drift parity. New composite **`(org_id, produced_at)`** index for the windowed scans. A **16-test parity suite** runs the *same* expectations against both stores (in-memory + pglite) so they can't drift.
- ✅ **Tenancy seam + RBAC** — `TenancyProvider.analytics(orgId,range)` returns an `AnalyticsSummary` (`TenancyService` delegates to the store + echoes the selection); **`NullTenancy` returns `undefined`** (no index → the dashboard's single-tenant empty state). New **`analytics:read`** action (viewer+) and an **org-scoped `authorizeOrg`** (membership → `can`) for the cross-workspace surface.
- ✅ **Server read-API** (`analytics-routes.ts`) — `GET /api/orgs/:orgId/analytics?from=&to=`. Single-tenant → `{enabled:false}` (no auth wall, graceful empty state); team mode → **session + org-membership required** (one org can't read another's spend), then aggregates. Optional `from`/`to` validated + normalized to canonical ISO; malformed → 400.
- ✅ **Web dashboard** (`components/dashboard/`) — a lazy-loaded `#/analytics` route (its own **~2 kB-gzip chunk**, off the landing bundle): headline spend/token/run cards, a **dependency-free SVG** daily-spend series, ranked by-workspace/model/target bars — reusing the dark build-workbench tokens (not a template). Range presets (7/30/90-day, all-time), org switcher when the user has several, graceful single-tenant + empty states. Fetching is gated on org resolution (one request, no loading flash). Pure transforms (range presets, zero-safe bar scaling) unit-tested; the component tested across all four states.
- ✅ **Reviewed (code-review + verification-loop + security pass).** Clean on injection (parameterized Drizzle, no user input in raw SQL), IDOR/cross-org leakage (org-membership default-deny 403), secret/PII exposure (the index never holds the resolved prompt/params — those stay in the CAS), and the framework boundary (`lint:deps` green). One review nit fixed (immutable range build). **Honest semantic, documented in both READMEs + UI:** the index is keyed by `(workspace, identity-hash)` and upserted, so figures are **distinct artifact-production cost** — cache-hit/no-op rebuilds don't re-accrue; day buckets are UTC. **All green: 479 package + 5 script + 3 e2e** (server 151 → 177; web 36 → 58). *No analytics-specific e2e: the no-DB e2e harness can't populate a team-mode index; covered instead by pglite integration + component tests across all states.*

### Done (Phase 3 — LLM router: multi-provider fallback + cost-aware routing · 2026-06-15, TDD · Apache-2.0)
> Deepens the provider router (SPEC §4.2) so a build survives a transient provider failure without losing the artifact, with optional cost-aware ordering — all framework-side (Apache-2.0; `lint:deps` stays green).
- ✅ **Classified provider errors** (`providers/errors.ts`) — adapters translate vendor/HTTP failures into a `ProviderError` with a retryable/fatal `kind` (rate_limit/overload/server/timeout/unavailable vs auth/bad_request/unknown). Anthropic SDK `.status` + connection errors and the OpenAI-compatible `fetch` status/network paths both map through `kindFromStatus`. Each adapter now also reports the model that actually answered on `CompletionResult.model`.
- ✅ **Fallback walker + cost ordering** (`providers/fallback.ts` + `pricing.ts` + `model-ref.ts`) — `buildChain(model, fallback, route)` puts the declared primary first and (under `route: cost-aware`) sorts the **fallback alternatives** cheapest-first via a shared blended-price table (unpriced last, deduped). `runWithFallback` advances only on a transient error, fails fast on a fatal one, skips unconfigured providers, and throws an aggregate of every attempt on exhaustion. Pricing extracted from `anthropic.ts` into its own module (single home, reused by cost ordering; re-exported for back-compat). The router consumes it; the no-fallback path is byte-identical to before (zero regression).
- ✅ **Recipe surface** (`shared` + `format`) — `RecipeHeader` gains `fallback: string[]` + `route: strict|cost-aware`; parser/serializer round-trip them; schema rejects unknown route values. `Provenance` gains `requestedModel` + `fellBack`.
- ✅ **Engine wiring + provenance honesty** (`engine/hash.ts` + `build.ts`) — `normalizeHeader` folds `fallback`+`route` into the **identity hash**, so a target's cache identity is the *recipe spec*, **never** the runtime model (a transient fallback never orphans the cache; the recipe author declared the chain members as acceptable substitutes). chat/eval, stochastic, and map steps forward the chain and record the **actual** producing model in provenance — with `requestedModel`+`fellBack` when a fallback changed it (map summarizes a mixed aggregate honestly). A fell-back build never misattributes its artifact; cost analytics now attributes spend to the model that truly ran.
- ✅ **Web UX** — the inspector "why" tab shows an amber **"fell back from &lt;model&gt;"** chip next to the Model row (pure `fallbackNote()` helper, unit-tested; reuses the stale-status hue — honest, not a template).
- ✅ **Reviewed (code-review + verification-loop + security-scan).** No CRITICAL/HIGH/MEDIUM in repo code: no secrets/eval/shell, model refs are string-split + table-lookup only (no injection), spec-based hash blocks cache poisoning, bounded fallback walk (no DoS), framework boundary intact (`lint:deps` green). AgentShield findings were all in the third-party plugin cache, none in this repo. **All green: 547 package + 5 script + 3 e2e** (providers 18 → 77, engine 125 → 130, format 10 → 14, web 58 → 61; shared/server pass-through unchanged). Determinism + provenance contract documented in SPEC §4.2/§8.

### Remaining
1. **Later hardening (optional):** session cache (avoid per-request DB hit); admin-assigned (vs first-come) workspace registration; agent-in-container; a `transform` needing allow-listed `node_modules`; an example demoing `sandbox: container`; the object-store/CDN backing for shared artifacts (seam in place); rate-limit the analytics read endpoint; multi-org analytics roll-up + CSV export; **per-model retry/backoff before advancing the chain; a global front-matter default fallback chain; pricing for OpenAI-compatible models (cost-aware currently orders only known-priced models).**

---

## Appendix — Key sources (June 2026)
- Patrick Collison tweet (2026-06-07) · Retool interview "Stripe CEO on the future of software"
- Overmind: docs.overmindlab.ai · github.com/overmind-core/overmind
- Kronn: github.com/docroms/kronn · Ark: github.com/ytarasova/ark · Agor: github.com/preset-io/agor
- Kanwas: github.com/kanwas-ai/kanwas · Canopy: github.com/RogerNavelsaker/canopy · PromptScript: getpromptscript.dev
- Raison: raison.ist · Langtail: langtail.com · Ordinus: ordinus.ai · Automaker: github.com/AutoMaker-Org/automaker · HighFlow: github.com/HighGarden-Studio/HighFlow
- AI21 "Caching in Agentic LLM Pipelines" (content-addressed cache key) · ZenML prompt-as-artifact · MarkItDown v0.1.6
- Promptfoo→OpenAI acquisition (~$86M, Mar 2026)
