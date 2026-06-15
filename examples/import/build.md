---
defaults:
  model: anthropic:cc/claude-sonnet-4-6
artifacts_dir: artifacts
---

# Import → build

This workspace shows the import path: a non-Markdown file (`raw/quarterly-report.html`)
is converted to a Markdown **source** with `md import`, then consumed by a normal
`chat` target like any other source. See `README.md` for the step-by-step run.

## target: exec-summary
```yaml
inputs: [sources/quarterly-report.md]
step: chat
output: artifacts/exec-summary.md
cache: deterministic
```
You are an analyst. Using only the report in {{sources/quarterly-report.md}},
write a 4-bullet executive summary, then a one-line "Top risk:" call-out.
