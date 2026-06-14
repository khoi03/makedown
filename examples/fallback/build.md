---
artifacts_dir: artifacts
---

# Multi-provider fallback

A build survives a transient provider failure (rate-limit, overload, network, or
an unavailable model) by walking a declared `fallback` chain instead of losing
the artifact. The model that **actually** produced each artifact is recorded in
provenance — run `md why <target>` to see it, with a "fell back from …" note when
the primary was substituted.

```
cp examples/fallback/.env.example examples/fallback/.env   # add your keys
md build examples/fallback
md why  examples/fallback forced-fallback                  # see which model ran
```

See `SPEC.md` §4.2 for the routing/determinism rules. The `fallback`/`route`
spec is part of each target's identity hash, so caching stays deterministic no
matter which chain member answered.

## target: resilient
```yaml
inputs: [sources/topic.md]
step: chat
model: anthropic:cc/claude-sonnet-4-6
fallback: [anthropic:cc/claude-haiku-4-5-20251001, openai:gemma4:31b-cloud]
output: artifacts/resilient.md
cache: deterministic
```
Explain the topic in {{sources/topic.md}} to a smart 12-year-old, in exactly four sentences.


## target: forced-fallback
```yaml
inputs: [sources/topic.md]
step: chat
model: anthropic:claude-nonexistent-9
fallback: [anthropic:cc/claude-sonnet-4-6]
output: artifacts/forced.md
cache: deterministic
```
The primary model id above does not exist, so the provider returns 404
(unavailable) — a transient error that advances to the fallback. After building,
`md why examples/fallback forced-fallback` will show `claude-sonnet-4-6` as the
producing model with a "fell back from anthropic:claude-nonexistent-9" note.

Explain the topic in {{sources/topic.md}} to a smart 12-year-old, in exactly four sentences.


## target: cheapest-first
```yaml
inputs: [sources/topic.md]
step: chat
model: anthropic:cc/claude-opus-4-6
fallback: [anthropic:cc/claude-haiku-4-5-20251001, anthropic:cc/claude-sonnet-4-6]
route: cost-aware
output: artifacts/cheap.md
cache: deterministic
```
With `route: cost-aware`, the primary (opus) is still tried first, but the
fallback alternatives are reordered cheapest-first — so if opus is unavailable
the chain prefers haiku, then sonnet, then opus-4-7.

Explain the topic in {{sources/topic.md}} to a smart 12-year-old, in exactly four sentences.
