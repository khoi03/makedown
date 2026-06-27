---
defaults:
  model: anthropic:cc/claude-sonnet-4-6
  params: { temperature: 0, seed: 7 }
artifacts_dir: artifacts
---

# Flagship showcase — quarterly-report intelligence

One literate pipeline that exercises the whole product end to end: a binary
source is **auto-imported**, distilled by a deterministic **transform**, summarized
by a cost-aware **chat** step that **falls back** across providers, and turned into
a stakeholder memo by an **agent** behind a **human-approval gate**. The summary is
then **shareable** as a self-contained, read-only artifact.

```
quarterly-report.html ──(auto-import)──► extract (transform) ──► summary (chat, fallback)
                                                                    └──► memo (agent, approval)
```

## Try it without a key first

Planning works with **no API key and no model calls** — the auto-import is hashed,
the transform is deterministic, and cost is estimated from the rendered prompts:

```
md status examples/showcase     # extract is stale; summary/memo need a model
md graph  examples/showcase      # the dependency chain, in execution order
md cost   examples/showcase      # token/$ upper bound (dry run, no calls)
md build  examples/showcase      # builds extract at zero cost; defers the model steps
md why    extract examples/showcase
```

`md status`/`cost`/`why` work even **without** MarkItDown installed (the source is
hashed by raw bytes in that degraded mode). To actually build `extract` you need
[MarkItDown](https://github.com/microsoft/markitdown): `pip install 'markitdown[all]'`.

## Then go live

Copy `.env.example` to `.env`, add a key, and build the model steps:

```
cp examples/showcase/.env.example examples/showcase/.env   # add ANTHROPIC_API_KEY
md build examples/showcase                                  # runs summary; prompts to approve memo
md why   summary examples/showcase                          # which model actually produced it
md share summary examples/showcase --provenance            # export a shareable HTML artifact
```

See `README.md` for the full walkthrough and `scripts/demo.mjs` for a scripted run.

---

## target: extract
```yaml
inputs: [sources/quarterly-report.html]
step: transform
transform: extract.js
output: artifacts/brief.md
cache: deterministic
```
**`transform` over an auto-imported source.** `sources/quarterly-report.html` is
referenced directly, so the engine converts it to Markdown on resolve (MarkItDown)
and hands the text to `extract.js` — **zero tokens, no key**. The script distills
the report into a compact brief (title, headline figures, highlights, the segment
table). Editing the HTML *or* upgrading MarkItDown restales this target, because
the conversion id is folded into its identity hash. This prose is ignored by
transform steps.

## target: summary
```yaml
inputs: [extract]
step: chat
model: anthropic:cc/claude-sonnet-4-6
fallback: [anthropic:cc/claude-haiku-4-5-20251001, openai:gpt-4.1-mini]
route: cost-aware
output: artifacts/summary.md
cache: deterministic
```
**`chat` with a cost-aware fallback chain.** The primary (sonnet) is tried first;
if it is unavailable or throttled the build walks the `fallback` chain instead of
losing the artifact, and with `route: cost-aware` the alternatives are reordered
cheapest-first. The model that *actually* answered is recorded in provenance — run
`md why summary` to see it, with a "fell back from …" note when the primary was
substituted. The chain is part of the identity hash, so caching stays deterministic
no matter which member answered.

Write a tight executive summary of this quarterly brief for a busy CEO: three
sentences, then a one-line "biggest risk". Brief:

{{extract}}

## target: memo
```yaml
inputs: [summary, sources/memo-task.md]
step: agent
agent: claude-code
sandbox: worktree
approval: required
output: artifacts/memo.diff
```
**`agent` behind an approval gate.** A coding agent runs in an isolated git
worktree (a throwaway checkout of `HEAD`, never your working tree) to carry out
`{{sources/memo-task.md}}`. Before anything is written you see the unified **diff**
of what it changed and approve or decline; on approval the diff is saved to
`artifacts/memo.diff` (apply it with `git apply`). Requires the agent runtime
(`npm install @anthropic-ai/claude-agent-sdk`), a key, and a git repo with at least
one commit.

Carry out the task in {{sources/memo-task.md}} using this summary:

{{summary}}
