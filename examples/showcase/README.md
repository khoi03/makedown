# Flagship showcase — quarterly-report intelligence

The one example that exercises the whole product end to end. A binary report is
**auto-imported**, distilled by a deterministic **transform**, summarized by a
cost-aware **chat** step that **falls back** across providers, and turned into a
stakeholder memo by an **agent** behind a **human-approval gate** — and the
summary is then **shareable** as a self-contained, read-only artifact.

```
quarterly-report.html ──(auto-import)──► extract (transform) ──► summary (chat, fallback)
                                                                    └──► memo (agent, approval)
```

| Target    | Step        | Needs a key? | What it shows |
| --------- | ----------- | ------------ | ------------- |
| `extract` | `transform` | no           | in-graph auto-import + deterministic, zero-token build |
| `summary` | `chat`      | yes          | cost-aware fallback chain across providers |
| `memo`    | `agent`     | yes          | sandboxed agent + human-approval diff gate |

## 1. Plan it (no key, no model calls)

Planning is free: the auto-import is content-hashed, the transform is
deterministic, and cost is estimated from the rendered prompts.

```bash
md status examples/showcase     # extract is stale; summary/memo need a model
md graph  examples/showcase      # the dependency chain, in execution order
md cost   examples/showcase      # token/$ upper bound (dry run, no calls)
md why    extract examples/showcase
```

`status` / `cost` / `why` / `graph` work even **without** MarkItDown — the source
is hashed by raw bytes in that degraded mode, so the plan stays stable.

## 2. Build the free part

To actually *build* `extract` you need
[MarkItDown](https://github.com/microsoft/markitdown) to convert the HTML:

```bash
pip install 'markitdown[all]'        # one-time; or set MAKEDOWN_MARKITDOWN_CMD
md build examples/showcase            # builds extract at zero cost; defers the model steps
```

`extract.js` distills the imported report into `artifacts/brief.md` — title,
headline figures, highlights, and the segment-revenue table. Editing the HTML *or*
upgrading MarkItDown restales `extract`, because the conversion id is folded into
its identity hash.

## 3. Go live (key required)

```bash
cp examples/showcase/.env.example examples/showcase/.env   # add ANTHROPIC_API_KEY
md build examples/showcase                                  # runs summary; prompts to approve memo
```

- **`summary`** sends the brief to the primary model (`sonnet`). If it is
  unavailable or throttled, the build walks the `fallback` chain instead of losing
  the artifact; with `route: cost-aware` the alternatives are tried cheapest-first.
  `md why summary examples/showcase` shows the model that *actually* answered, with
  a "fell back from …" note when the primary was substituted.
- **`memo`** runs a coding agent in an isolated git worktree (a throwaway checkout
  of `HEAD`, never your working tree). You see the unified **diff** it produced and
  approve or decline; on approval it is saved to `artifacts/memo.diff`. Apply it
  with `git apply examples/showcase/artifacts/memo.diff`. Needs the agent runtime
  (`npm install @anthropic-ai/claude-agent-sdk`) and a git repo with a commit.

## 4. Share the artifact

```bash
md share summary examples/showcase --provenance
```

Exports a self-contained, read-only HTML file (model, tokens, and cost included
with `--provenance`) — open it in a browser or host it anywhere. In the
collaborative web app, the same artifact gets a revocable public link.

## Scripted walkthrough

`scripts/demo.mjs` runs the key-free slice of this walkthrough end to end and
prints each step — see the repo root `README.md` § *Guided demo*.
