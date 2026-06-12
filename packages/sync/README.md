# @makedown/sync — AGPL-3.0

The real-time collaboration layer:

- **Yjs CRDT** document sync for `build.md` and source files
- **git-backed** workspace persistence (snapshots ↔ commits, branches)
- presence, cursors, comments

**License:** **AGPL-3.0** (see [`LICENSE`](./LICENSE)) — dual-licensed; a
commercial exception is available, see [`/LICENSING.md`](../../LICENSING.md) and
`PLAN.md` §15. The Apache-2.0 framework (e.g. `@makedown/engine`) must never
import from here; the engine-standalone lint (`pnpm lint:deps`) enforces this.
