---
artifacts_dir: artifacts
sources_dir: sources
---

# Demo workspace

A zero-dependency `transform` build used by the end-to-end test — it needs no
API key, so the whole open → edit → build → artifact flow runs offline.

## target: shout
```yaml
inputs: [sources/note.md]
step: transform
transform: transforms/shout.mjs
sandbox: none
output: artifacts/shout.txt
cache: deterministic
```
