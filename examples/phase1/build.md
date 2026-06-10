---
defaults:
  model: cc/claude-sonnet-4-6
artifacts_dir: artifacts
---

# Phase 1 showcase

A single literate pipeline that exercises every Phase 1 step type and the
`stochastic` cache policy. Two independent chains form the DAG:

```
topic-list (transform) ──► blurbs (map)
digest (chat, stochastic) ──► digest-score (eval)
```

Try it without a key first — only `topic-list` (a `transform`) runs, at zero
token cost:

```
md status examples/phase1     # everything stale
md graph  examples/phase1      # the two dependency chains, in order
md cost   examples/phase1      # estimated token/$ upper bound (no model calls)
md build  examples/phase1      # builds topic-list; the model steps want a key
md why    topic-list examples/phase1
```

Then drop an `ANTHROPIC_API_KEY` (or any OpenAI-compatible key) into
`examples/phase1/.env` (see `.env.example`) and `md build` again to run the rest.
Swap the `model:` above for one your key can access.

---

## target: topic-list
```yaml
inputs: [sources/topics.md]
step: transform
transform: transforms/to-list.mjs
output: artifacts/topic-list.json
```
**`transform`** runs deterministic workspace code (`transforms/to-list.mjs`) with
**zero tokens** — it parses the bullet list in `sources/topics.md` into a JSON
array. No model, no key. Edit the script and the target rebuilds (its content is
part of the identity hash). This prose body is ignored by transform steps.

## target: blurbs
```yaml
inputs: [topic-list]
step: map
over: topic-list
params: { max_tokens: 200 }
output: artifacts/blurbs.json
```
**`map`** fans a prompt out `over` a list — here the JSON array produced by the
`topic-list` transform. The engine calls the model once per element with the
built-in `{{item}}` bound to that element, and collects the results into one
JSON-array artifact.

Write a one-sentence blurb explaining "{{item}}" to a curious beginner.

## target: digest
```yaml
inputs: [sources/topics.md]
step: chat
cache: stochastic(n=3)
params: { temperature: 1 }
output: artifacts/digest.md
```
**`stochastic(n=3)`** stores up to three sample artifacts under one identity hash
instead of a single cached result — so you can see model variance. The target is
stale until all three exist; `md why digest examples/phase1` shows the sample
count. Downstream targets consume the "blessed" sample (index 0 by default).

Write a punchy two-sentence digest of the themes in {{sources/topics.md}}.

## target: digest-score
```yaml
inputs: [digest]
step: eval
schema: { type: object, properties: { score: { type: integer }, rationale: { type: string } } }
params: { temperature: 0 }
output: artifacts/digest-score.json
```
**`eval`** scores an input artifact. Because a `schema` is declared, the build
fails unless the model returns valid JSON — so downstream targets can rely on a
real object. (Full JSON-Schema conformance is a future refinement; today the
engine enforces parseability.)

Score the digest {{digest}} from 1-10 for clarity and punch. Reply with ONLY a
JSON object: {"score": <integer 1-10>, "rationale": "<one sentence>"}.
