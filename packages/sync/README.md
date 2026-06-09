# @makedown/sync — COMMERCIAL

Placeholder for the commercial real-time collaboration layer:

- **Yjs CRDT** document sync for `build.md` and source files
- **git-backed** workspace persistence (snapshots ↔ commits, branches)
- presence, cursors, comments

**License:** proprietary / source-available — **not** Apache-2.0. This package is
intentionally outside the open-source boundary (see `PLAN.md` §15). The OSS engine
(`@makedown/engine`) must never import from here; a dependency-direction lint
enforces this.
