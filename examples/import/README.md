# Import example — any-file → Markdown source

Sources in Makedown are Markdown/text. This workspace shows how to bring a
non-Markdown file into the graph: convert it to a Markdown **source** with
`md import`, then reference it from a target like any other source.

`raw/quarterly-report.html` is the input file. (HTML needs only the base
converter, so it runs with a bare `pip install markitdown` — no extras.)

## Run it

```bash
pip install markitdown                         # one-time (use 'markitdown[all]' for PDF/DOCX/XLSX/…)

# 1) Convert the file → a Markdown source inside this workspace.
md import examples/import/raw/quarterly-report.html examples/import
#    → writes examples/import/sources/quarterly-report.md

# 2) Now it's an ordinary source — inspect or build the target that uses it.
md render exec-summary examples/import         # the exact prompt (no tokens)
md build  examples/import                      # needs ANTHROPIC_API_KEY
md why    exec-summary examples/import          # provenance of the summary
```

Re-running `md import` on an unchanged file is a **cache hit** — it prints
`(from cache)` and does no second conversion (the result is keyed on the source
bytes + the importer version). Change the HTML and re-import to see a fresh
conversion.

## Notes

- The output (`sources/quarterly-report.md`) is written **inside** the workspace
  and is confined there; the named input file is read as-is.
- `md import <file> [dir] [-o <path>]` — `dir` is the workspace (defaults to the
  current directory); `-o` overrides the output path (must stay in the workspace).
- MarkItDown is an **optional external tool**, invoked as a subprocess. If it's
  not installed, `md import` prints a `pip install` hint instead of crashing.
