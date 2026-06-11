# `build.md` Format Specification

**Version:** 0.1.0 (draft) · **Status:** unstable, pre-1.0 · **License:** Apache-2.0

> This is the open standard at the heart of Makedown. The format is deliberately
> simple — a Markdown document whose fenced **target blocks** declare a build
> graph. Any tool may parse, produce, or execute `build.md`; the format is not
> owned by the cloud product.

---

## 1. Design goals

1. **Human-first.** A `build.md` reads like a document and edits like one (so it
   works in Notion-style collaborative editors and in plain text/git).
2. **Declarative.** You describe *targets and their inputs*, not an imperative
   sequence. The engine derives the DAG and the execution order.
3. **Content-addressable.** Everything needed to compute a target's identity
   hash is in the block: inputs, step, model, params, and the prompt body.
4. **Reproducible.** Given the same resolved inputs + recipe + model + params, a
   `deterministic` target yields the same artifact (and is cache-reused).
5. **Tool-agnostic.** No dependency on the Makedown cloud. The OSS engine runs a
   `build.md` fully locally.

---

## 2. Document structure

A `build.md` file is standard CommonMark with three recognized region types:

| Region | Marker | Meaning |
|---|---|---|
| **Front matter** (optional) | leading `---` YAML block | workspace-level defaults |
| **Target block** | `## target: <name>` heading | one node in the build graph |
| **Prose** | anything else | ignored by the engine (docs, notes) |

Prose between targets is free — the engine only extracts target blocks. This is
what makes the build spec a *literate* document.

### 2.1 Front matter (optional)

```yaml
---
version: 0.1                 # spec version this document targets
defaults:
  model: claude-opus-4-8     # default model for targets that omit one
  system: You are precise.   # default system prompt (targets may override)
  params: { temperature: 0 } # default params, shallow-merged per target
  cache: deterministic       # default cache policy
artifacts_dir: artifacts     # where output files are written (default: artifacts)
sources_dir: sources         # root for relative source paths (default: repo root)
---
```

All front-matter keys are optional. A target's own fields override defaults.

---

## 3. Target block

A target block is a level-2 heading of the exact form `## target: <name>`,
immediately followed by **one fenced `yaml` code block** (the recipe header),
followed by the **prompt body** (everything up to the next target heading or EOF).

````markdown
## target: <name>
```yaml
# recipe header — see §4
inputs: [...]
step: chat
model: claude-opus-4-8
output: artifacts/<name>.md
cache: deterministic
```
<prompt body — Markdown; may reference inputs via {{...}} — see §5>
````

### 3.1 Target name

- Must match `^[a-z0-9][a-z0-9_-]*$` (kebab/snake, lowercase).
- Unique within the document.
- Used as the dependency reference from other targets (see §4 `inputs`).

---

## 4. Recipe header fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `inputs` | `string[]` | no | `[]` | Each entry is **either** a source path (relative file) **or** another target name. The engine classifies by matching against declared target names. |
| `step` | enum | no | `chat` | `chat` \| `agent` \| `transform` \| `eval` \| `map` (see §6) |
| `model` | string | for `chat`/`agent`/`eval` | front-matter default | Model id, optionally `provider:model` (see §4.1), e.g. `claude-opus-4-8`, `openai:gpt-5`. |
| `system` | string | no | front-matter default | System prompt. May contain `{{ref}}` interpolations (see §5). Part of the identity hash. |
| `params` | object | no | front-matter default | Model params (`temperature`, `seed`, `max_tokens`, …), shallow-merged over defaults. |
| `output` | string | no | `<artifacts_dir>/<name>.md` | Path the compiled artifact is written to. |
| `cache` | enum | no | `deterministic` | `deterministic` \| `stochastic(n=<k>)` \| `always` (see §7) |
| `agent` | string | for `step: agent` | — | Coding-agent runtime id, e.g. `claude-code`. |
| `sandbox` | enum | no | `worktree` | `worktree` \| `container` \| `none` — isolation level for `agent`/`transform` (see §6). For `transform`: `worktree` = locked-down subprocess, `container` = Docker (also network-isolated), `none` = trusted in-process. |
| `approval` | enum | no | `none` | `none` \| `required` — gate before the artifact is accepted downstream. |
| `transform` | string | for `step: transform` | — | Path to a deterministic script (zero tokens). |
| `over` | string | for `step: map` | — | An input (target/source) that resolves to a list; the recipe fans out over its items. |
| `schema` | string \| object | no | — | Optional output schema (path to a JSON Schema or inline) the artifact is validated against. |

Unknown fields are a validation error in strict mode (default), a warning otherwise.

### 4.1 Provider routing

A `model` may carry an optional `provider:` prefix selecting the backend:

| Form | Routes to |
|---|---|
| `claude-opus-4-8` (bare) | the default provider (configurable; `anthropic` by default) |
| `anthropic:claude-opus-4-8` | Anthropic (native SDK) |
| `openai:gpt-5` | OpenAI-compatible `/chat/completions` |
| `openai:meta-llama/llama-3.3-70b` | OpenAI-compatible (slashes in the model id are preserved) |

The `openai:` backend targets **any** OpenAI-compatible endpoint — OpenAI,
OpenRouter, Groq, Together, Ollama, vLLM, LM Studio — selected by base URL.
Credentials and base URLs come from the environment / a workspace `.env`
(`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
`MAKEDOWN_DEFAULT_PROVIDER`). The whole `model` string (prefix included) is part
of the target's identity hash, so switching providers rebuilds. This makes
side-by-side model comparison a natural pattern: define one target per model with
the same prompt and `md build`, then diff the artifacts (see `examples/compare`).

---

## 5. Input references in the prompt body

Within a prompt body, `{{<ref>}}` interpolates a resolved input:

- `{{sources/notes.md}}` — inlines the (text) content of a source file.
- `{{some-target}}` — inlines the compiled artifact of another target.
- `{{sources/data.csv:head(20)}}` — optional **transform suffix** (`:fn(args)`);
  reserved for built-in slicers (`head`, `tail`, `slice`, `json`). Pre-1.0: only
  `head`/`tail` are guaranteed.

Every `{{ref}}` used in the body **must** also appear in `inputs` (so the
dependency graph is explicit and the identity hash is complete). Referencing an
input not declared in `inputs` is a validation error.

The `system` prompt (§4) is rendered the same way — its `{{ref}}`s are
interpolated identically and must also be declared in `inputs`. Inspect the
fully-rendered system + user prompt for any target with `md render <target>`
(no model call, no tokens spent).

---

## 6. Step types

| `step` | Purpose | Produces | Tokens |
|---|---|---|---|
| `chat` | One inference call against `model` with the rendered prompt. | text/markdown/JSON artifact | yes |
| `agent` | Run a general-purpose **coding agent** (`agent:`) in an isolated `sandbox`, with inputs available. | files / diffs / code | yes |
| `transform` | Run deterministic code (`transform:`). **"Code where code is enough."** | any file | **zero** |
| `eval` | Score/grade an input artifact against criteria (the prompt body or `schema`). | structured score artifact | yes |
| `map` | Fan a child recipe out `over` a list input; collects results into one artifact. | array/collection artifact | depends |

`agent` artifacts default to `cache: always` and should usually set
`approval: required` (non-deterministic, side-effectful).

> **Security model.** `transform` and `agent` both execute code. The engine is
> hardened to run an untrusted `build.md` safely (Phase 1.5):
>
> - **Path confinement.** Every declared path — inputs, `output`, `transform`
>   scripts, and `over` lists — is resolved inside the workspace root. Absolute
>   paths, `..` escapes, and symlinks that point outside the workspace are
>   rejected before any read or write.
> - **`transform` isolation** is selected by the target's `sandbox` field:
>   - `worktree` (the default) runs the script in a **locked-down subprocess**
>     under Node's permission model: **no ambient filesystem** (it sees only the
>     resolved input *values* it is handed), **no inherited environment** (the
>     parent's API keys are scrubbed), a **memory cap**, and a **wall-clock cap**.
>     Note the permission model does not gate **network**.
>   - `container` runs the script in **Docker** — everything `worktree` gives,
>     plus **`--network none`** (the only level that also closes the network) and
>     hard CPU/PID caps, with only the script mounted read-only. Docker is an
>     optional dependency, touched only on this path.
>   - `none` imports the script **in-process**, exactly like a `make` recipe runs
>     shell — the trusted escape hatch for transforms you author (full filesystem,
>     environment, and network). Only use it for a `build.md` you control.
> - **`agent` isolation** uses the same `sandbox` field: `worktree` provisions a
>   **real, isolated `git worktree`** (a throwaway checkout off `HEAD`, torn down
>   after the run) so the agent edits a copy, not your working tree; `none` runs
>   in the workspace itself (advisory — trusted `build.md` only). Side-effectful
>   agent output is gated: with `approval: required`, the artifact is accepted only
>   on explicit human approval, and is otherwise discarded (never written to disk
>   or the CAS, and downstream targets that depend on it are skipped).
> - **`map` fan-out** is capped (default 1000 items) so a runaway or untrusted
>   list cannot spawn unbounded inference.
>
> The agent's API credentials are read from the environment by the agent runtime —
> they are never embedded in `build.md`.

---

## 7. Cache policy & determinism

The engine computes a target's **identity hash**:

```
id = sha256(
  canonical(resolved_input_hashes) ||
  canonical(recipe_header_normalized) ||
  prompt_body ||
  model_id ||
  canonical(params)
)
```

A target is **stale** iff no artifact exists for its current `id`. Only stale
targets (and everything transitively downstream of a changed input) recompute.

| `cache` value | Behavior |
|---|---|
| `deterministic` | Requires effectively deterministic params (e.g. `temperature: 0`, optional `seed`). The artifact is cached by `id` and reused on every future build with no inference. |
| `stochastic(n=k)` | Stores up to `k` sample artifacts per `id` as siblings. The build surfaces variance; a user may pin a "blessed" sample that downstream targets consume. |
| `always` | Never cached; recomputes every build. Typical for `agent` steps. Combine with `approval: required`. |

> **Note on LLM non-determinism.** `deterministic` is a *contract you opt into*,
> not a guarantee the provider makes. The engine caches aggressively by identity
> hash; if a provider drifts, deleting the artifact forces a rebuild. This is why
> determinism is a first-class, per-target choice.
>
> **Note on `params` vs. what the API receives.** A target's `params` always
> participate in its identity hash (changing them rebuilds) and document intent —
> but a provider only *sends* the parameters the target model accepts. Current
> Opus models (4.8/4.7) reject `temperature`/`top_p`/`top_k`/`seed`, so those are
> advisory for them: they key the cache but are not transmitted. Determinism on
> such models comes from the provider sending a minimal, stable request, not from
> a temperature knob.

---

## 8. Artifacts & provenance

Each produced artifact has a provenance record (stored alongside it in the CAS):

```jsonc
{
  "target": "market-summary",
  "id": "sha256:…",                 // identity hash (§7)
  "output": "artifacts/market-summary.md",
  "step": "chat",
  "model": "claude-opus-4-8",
  "params": { "temperature": 0, "seed": 7 },
  "inputs": [
    { "ref": "sources/raw-notes.md", "kind": "source", "hash": "sha256:…" },
    { "ref": "sources/prices.csv",   "kind": "source", "hash": "sha256:…" }
  ],
  "prompt_hash": "sha256:…",
  "tokens": { "input": 1234, "output": 567 },
  "cost_usd": 0.0421,
  "duration_ms": 3120,
  "produced_at": "2026-06-09T12:00:00Z",  // ISO 8601 UTC
  "produced_by": "user:abc | agent:claude-code"
}
```

This record powers `md why <target>`, reproducibility, and cost analytics.

---

## 9. Worked example

````markdown
---
defaults:
  model: claude-opus-4-8
  params: { temperature: 0, seed: 7 }
artifacts_dir: artifacts
---

# Quarterly market brief

A literate pipeline: raw notes + price data → summary → drafted PR against the repo.

## target: market-summary
```yaml
inputs: [sources/raw-notes.md, sources/prices.csv]
step: chat
output: artifacts/market-summary.md
cache: deterministic
```
Summarize the trading notes in {{sources/raw-notes.md}} using the price series
in {{sources/prices.csv:head(50)}}. Output a 5-bullet executive summary.

## target: refactor-pr
```yaml
inputs: [market-summary, sources/spec.md]
step: agent
agent: claude-code
sandbox: worktree
output: artifacts/refactor.diff
cache: always
approval: required
```
Using the summary {{market-summary}} and the spec {{sources/spec.md}}, implement
the change in an isolated worktree and emit a unified diff.
````

`md build` resolves the DAG `market-summary → refactor-pr`. Editing
`sources/prices.csv` re-runs only `market-summary` (and, because it changed,
`refactor-pr`); editing nothing re-runs nothing.

---

## 10. Conformance

A conforming **parser** MUST:
- extract every `## target: <name>` block with its `yaml` header + body;
- reject duplicate target names and malformed names (§3.1);
- reject `{{ref}}` not present in `inputs` (§5) in strict mode.

A conforming **engine** MUST:
- compute identity hashes per §7 and skip non-stale targets;
- record provenance per §8;
- honor cache policies per §7.

---

## 11. Reserved / future (non-normative)

- `:fn(args)` body transforms beyond `head`/`tail`.
- `when:` conditional targets; `matrix:` parameter sweeps.
- Remote/imported sub-graphs (`import:`).
- Signed provenance for externally shared artifacts.

Changes are tracked in this file's version header; pre-1.0 may break.
