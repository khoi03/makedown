---
artifacts_dir: artifacts
---

# In-graph auto-import

This workspace shows **in-graph auto-import**: a non-Markdown file
(`sources/report.html`) is referenced **directly** in a target's `inputs:` and is
converted to Markdown *on resolve* — no separate `md import` step. The conversion
is cached by content hash, so editing the HTML re-imports and restales this
target. It runs **without an API key** (the step is a deterministic `transform`),
but the host must have [MarkItDown](https://github.com/microsoft/markitdown)
installed: `pip install 'markitdown[all]'`.

See `README.md` for the step-by-step run.

## target: report-stats
```yaml
inputs: [sources/report.html]
step: transform
transform: transform.js
output: artifacts/report-stats.md
cache: deterministic
```
Summarize structural stats of the auto-imported report.
