# @makedown/web — AGPL-3.0

The web app: a Notion-style collaborative editor over `build.md` + sources, a
live build-graph (DAG) view, the artifact viewer / shareable published views, and
a **cost analytics dashboard**.

The dashboard (`#/analytics`, lazy-loaded as its own ~2 kB-gzip chunk off the
landing bundle) is an org-scoped, read-only view over the server's provenance
index: headline spend / token / run cards, a dependency-free SVG daily-spend
series, and ranked by-workspace / model / target bars — reusing the dark
build-workbench tokens. It fetches on open and on range change (7/30/90-day or
all-time), switches org when the user belongs to several, and degrades
gracefully: a "team mode" explainer when the server is single-tenant (no index),
and an empty state when there are no builds in range.

**License:** **AGPL-3.0** (see [`LICENSE`](./LICENSE)) — dual-licensed; a
commercial exception is available, see [`/LICENSING.md`](../../LICENSING.md) and
`PLAN.md` §15.
