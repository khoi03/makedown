# In-graph auto-import — a binary referenced directly in `inputs:`

The [`import`](../import) example converts a file to a Markdown source *ahead of
time* with `md import`. This example shows the **in-graph** form: a non-Markdown
file is named **directly** in a target's `inputs:` and is converted to Markdown
**on resolve**, transparently, as part of the build.

`sources/report.html` is the binary input. The `report-stats` target lists it in
`inputs:` and consumes it from a deterministic `transform` — so the whole thing
runs **without an API key**. The host only needs
[MarkItDown](https://github.com/microsoft/markitdown):

```bash
pip install markitdown        # HTML needs only the base converter
# (use 'markitdown[all]' for PDF/DOCX/PPTX/XLSX/…)
```

## Run it

```bash
# If the `markitdown` shim isn't on your PATH (common after `pip install --user`),
# point Makedown at it once:
#   Windows PowerShell:  $env:MAKEDOWN_MARKITDOWN_CMD = "python -m markitdown"
#   bash:                export MAKEDOWN_MARKITDOWN_CMD="python -m markitdown"

md build  examples/import-graph     # converts report.html on resolve, runs the transform
md why    report-stats examples/import-graph   # provenance — note the auto-imported input
```

You should see `report-stats` build and `artifacts/report-stats.md` appear with a
word count and the section titles pulled from the converted HTML.

## See the incremental contract

```bash
md build  examples/import-graph     # again → "0 built, 1 reused" (cached conversion + artifact)
# edit sources/report.html (add a heading), then:
md status examples/import-graph     # → report-stats is "stale"
md build  examples/import-graph     # re-imports the HTML and rebuilds only what changed
```

## How it works

- The target's identity hash folds in the **conversion identity** of the binary
  (its bytes + the importer id + the importer version + format hints), so editing
  the file *or* upgrading MarkItDown restales the target — content-addressed, not
  mtime-based.
- The conversion is cached under `.makedown/imports/` (keyed on the same identity),
  so an unchanged file is converted **once**, not on every build.
- The path is **confined to the workspace**: because the file is declared in
  `build.md` (not named on the CLI), a `..`-escape in `inputs:` is rejected before
  any read.
- Importable formats are an explicit allow-list (PDF/DOCX/PPTX/XLSX/HTML/EPUB/
  images/…). Native text — `.md`, `.txt`, `.csv`, `.json`, `.yaml` — is read
  as-is, never auto-converted.
- MarkItDown is an **optional external tool**, invoked as a subprocess. A build
  that needs it without it installed fails with a `pip install` hint, never a
  stack trace.
