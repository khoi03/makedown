---
artifacts_dir: artifacts
---

# Compare models on the same prompt

The same prompt, run against three models from two providers. Because each target
has its own cache, re-running only recomputes what changed — and you can diff the
artifacts side by side:

```
md build examples/compare
diff examples/compare/artifacts/opus.md examples/compare/artifacts/gpt.md
```

Edit `.env` (see `.env.example`) to set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`.
Swap the model ids below for ones your keys can access.

## target: sonnet
```yaml
inputs: [sources/topic.md]
step: chat
model: "anthropic:cc/claude-sonnet-4-6"
output: artifacts/sonnet.md
cache: deterministic
```
Explain the topic in {{sources/topic.md}} to a smart 12-year-old, in exactly four sentences.


## target: local
```yaml
inputs: [sources/topic.md]
step: chat
model: "openai:gemma4:31b-cloud"
output: artifacts/local.md
cache: deterministic
```
Explain the topic in {{sources/topic.md}} to a smart 12-year-old, in exactly four sentences.
