# Changelog

All notable changes to Makedown are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-27

First public release. The full build log lives in
[`docs/ROADMAP.md`](./docs/ROADMAP.md) §14.

### Added

- **Incremental build engine** — a `build.md` dependency graph with a
  content-addressed artifact store, identity-hash caching (no-op rebuilds cost zero
  tokens), and full provenance per artifact (inputs, prompt, model, params, cost,
  tokens). `md build` / `status` / `graph` / `render` / `why` / `cost`.
- **Step types** — `chat`, `eval` (optional JSON `schema`), `map` (fan out `over` a
  list), deterministic `transform` (zero tokens), and `agent` (coding agent in a
  sandbox behind an approval gate).
- **Cache policies** — `deterministic`, `stochastic(n=k)` (samples + a blessed
  pointer), and `always`.
- **Sandboxing** — workspace path confinement; `transform` isolation via a
  locked-down subprocess (default) or Docker `container` (`--network none`); `map`
  fan-out caps.
- **Multi-provider router** — `provider:model` selection across Anthropic and
  OpenAI-compatible endpoints, a declarative `fallback` chain with optional
  `route: cost-aware`, per-model retry/backoff (honoring `Retry-After`), and
  provenance that records the model that actually answered.
- **File import** — convert PDF/DOCX/PPTX/XLSX/HTML/EPUB/images to Markdown sources
  via MarkItDown (`md import`), with content-addressed conversion caching, plus
  in-graph **auto-import** when a binary is referenced directly in `inputs:`.
- **Collaborative workbench** (AGPL-3.0) — real-time CRDT co-editing of `build.md`
  and sources, a live DAG, streaming build progress (SSE), a human approval modal,
  and an artifact/provenance/cost inspector, backed by a Fastify server with
  git-backed snapshots and branches.
- **Optional teams** — self-host-first auth, org/team RBAC
  (`owner › admin › member › viewer`), and a Postgres provenance index, all inert
  unless `DATABASE_URL` is set. Cost-analytics dashboard over the index.
- **Sharing** — `md share` exports a self-contained read-only HTML artifact; the
  web app mints revocable, optionally-expiring public links behind a strict
  sanitizer + CSP.
- **Flagship example** (`examples/showcase`) plus a scripted demo
  (`scripts/demo.mjs`) and Playwright visual-regression coverage of the workbench.

### Licensing

- Dual-license: **Apache-2.0** framework (`engine`, `format`, `cli`, `providers`,
  `shared`, `agents`, `import`) + **AGPL-3.0** server/collaboration (`apps/server`,
  `packages/sync`, `packages/web`), with a commercial exception available by
  contract. The `build.md` format (`SPEC.md`) is an open standard.

[Unreleased]: https://github.com/khoi03/makedown/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/khoi03/makedown/releases/tag/v0.1.0
