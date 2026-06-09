---
defaults:
  model: cc/claude-sonnet-4-6
  params: { temperature: 0, seed: 7 }
artifacts_dir: artifacts
---

# Quickstart pipeline

A two-target literate build: summarize raw notes, then turn the summary into a
checklist. Edit `sources/notes.md` and run `md status` to see only `summary`
(and its dependent `checklist`) go stale.

## target: summary
```yaml
inputs: [sources/notes.md]
step: chat
output: artifacts/summary.md
cache: deterministic
```
Summarize the notes in {{sources/notes.md}} as three concise bullet points.

## target: checklist
```yaml
inputs: [summary]
step: chat
output: artifacts/checklist.md
cache: deterministic
```
Turn the summary {{summary}} into an actionable checklist of next steps.
