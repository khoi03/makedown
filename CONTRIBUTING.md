# Contributing to Makedown

Thanks for your interest in Makedown! This guide covers local setup, the test and
lint gates, and the conventions we follow.

## Development setup

Requirements: **Node.js ≥ 20** and **pnpm 9** (pinned via `packageManager`).

```bash
git clone https://github.com/khoi03/makedown.git
cd makedown
pnpm install
pnpm build          # build all packages (project references)
pnpm typecheck
pnpm test           # all package test suites (Vitest)
pnpm test:scripts   # repo scripts (the demo + guards)
pnpm lint:deps      # the engine-standalone guard (see below)
```

Run the CLI from source while developing:

```bash
pnpm md status examples/showcase      # = packages/cli/dist/index.js after a build
```

For the collaborative app, see [`docs/SELF-HOSTING.md`](./docs/SELF-HOSTING.md).

## Repository layout

A pnpm monorepo. The **framework** packages (`engine`, `format`, `cli`,
`providers`, `shared`, `agents`, `import`) are **Apache-2.0** and run a `build.md`
fully locally. The **server/collaboration** packages (`apps/server`,
`packages/sync`, `packages/web`) are **AGPL-3.0**. See
[`docs/ROADMAP.md`](./docs/ROADMAP.md) for the architecture.

### The engine-standalone discipline

`pnpm lint:deps` fails the build if any Apache-2.0 framework package imports an
AGPL server/collaboration package. This keeps the framework dependency-light and
cleanly Apache-2.0. Server/collab packages may depend on framework packages, never
the other way around. **Run `pnpm lint:deps` before every PR.**

## Testing

We practice test-driven development and keep coverage high. When you add or change
behavior:

- Write or update tests first; they should fail for the right reason, then pass.
- Prefer testing observable behavior over implementation details.
- Keep tests isolated and fast; mock external services (model providers, etc.).
- The `agent`, `transform`, and sharing surfaces touch the filesystem and
  subprocesses — cover the error and edge paths, not just the happy path.

The collaborative surface also has a real-browser Playwright e2e
(`pnpm --filter @makedown/web e2e`) — see the self-hosting guide.

## Commit and PR conventions

- **Conventional commits**: `type: summary` where type is one of `feat`, `fix`,
  `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
- Keep commits **small and logically grouped** — stage related files together
  rather than one giant commit.
- Before opening a PR, make sure `pnpm build && pnpm typecheck && pnpm test &&
  pnpm lint:deps` are all green.
- Describe the change and its rationale in the PR; link any related issue.

## Coding style

- TypeScript with explicit types on public APIs; avoid `any` (narrow `unknown`).
- Prefer immutable updates; handle errors explicitly (no silent swallowing).
- Small, focused files and functions; clear names over cleverness.
- No `console.log` in library/app code (CLI/dev scripts that print to the terminal
  are the exception).

## Licensing of contributions

Makedown is dual-licensed. By submitting a contribution you agree that:

- Contributions to the **Apache-2.0 framework** packages are provided under the
  Apache License 2.0.
- Contributions to the **AGPL-3.0 server/collaboration** packages are provided
  under the AGPL-3.0 **and** under terms that allow the project maintainer to also
  offer them under the separate commercial license described in
  [`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md) (inbound = outbound, plus the
  commercial-relicensing grant for the AGPL parts).

Please sign off your commits (`git commit -s`) to certify the
[Developer Certificate of Origin](https://developercertificate.org/).

## Reporting bugs and requesting features

Use the GitHub issue templates. For **security vulnerabilities**, do **not** open a
public issue — follow [`SECURITY.md`](./SECURITY.md).

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
