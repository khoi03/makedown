# Licensing

Makedown is **dual-licensed**. Different parts of this monorepo carry different
licenses, and a separate **commercial license** is available for uses that the
open-source licenses don't permit.

## At a glance

| Layer | Packages | License | What it means |
|---|---|---|---|
| **Framework** (the open `build.md` standard + the local engine) | `engine`, `format`, `cli`, `providers`, `shared`, `agents` | **Apache-2.0** | Use it for anything, including in closed-source and commercial products, for free. Includes a patent grant. The `build.md` format is an open spec — no lock-in. |
| **Server & collaboration** | `apps/server`, `packages/sync`, `packages/web` | **AGPL-3.0** | Free to use, self-host, modify, and redistribute — **provided** you comply with the AGPL: if you run a modified version as a network service, you must offer its complete source (including your modifications) to its users. |
| **Commercial exception** | the AGPL parts above | **proprietary, by contract** | If you cannot or do not want to comply with the AGPL — e.g. you want to embed the server/collab layer in a closed-source product, or offer it as a hosted service without publishing your changes — you may purchase a commercial license. See [`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md). |

Each package also declares its license in its `package.json` `license` field and,
where it differs from the repository root, ships its own `LICENSE` file. The
repository-root [`LICENSE`](./LICENSE) is the Apache-2.0 text that governs the
framework packages.

## Why this split

- The **framework is permissively licensed (Apache-2.0)** so the `build.md`
  format becomes a genuinely open standard that anyone can parse, produce, or
  execute — maximum adoption, zero lock-in. The engine runs a `build.md` fully
  locally with no server and no database.
- The **server and collaboration layer is AGPL-3.0** so the project stays open
  and self-hostable for everyone, while a hyperscaler can't take the hard,
  valuable hosted-collaboration part closed-source and offer it as a competing
  service without contributing their changes back (or buying a commercial
  license). This is the same posture used by projects like Grafana and PostHog.

## For contributors

Contributions to a package are made under that package's license (Apache-2.0 for
the framework, AGPL-3.0 for the server/collab packages). By contributing you
also grant the project maintainers the right to offer your contribution under
the **commercial license** described above — this is what makes dual-licensing
possible (the maintainers must hold the rights to relicense). If a formal
Contributor License Agreement (CLA) is later adopted, it will be linked here.

## Questions

For commercial licensing or any licensing question, see
[`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md).
