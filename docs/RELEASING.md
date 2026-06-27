# Releasing Makedown

A short maintainer checklist for cutting a release and publishing the CLI.

## What gets published

Only the **Apache-2.0 framework** packages are published to npm — they carry
`publishConfig.access = public` and are not `private`:

`@makedown/shared`, `@makedown/format`, `@makedown/engine`, `@makedown/providers`,
`@makedown/agents`, `@makedown/import`, `@makedown/cli`.

The AGPL server/collaboration packages (`@makedown/sync`, `@makedown/web`,
`@makedown/server`) are `private: true` and are **not** published to npm — they're
distributed via source and the Docker images.

## One-time setup

- Create the **`makedown` org on npm** (free for public scoped packages) so the
  `@makedown/*` names resolve, and make sure your npm account is a member.
- `npm login` locally, or set `NPM_TOKEN` in CI.

## Release checklist

1. **Green build** on a clean tree:
   ```bash
   pnpm install --frozen-lockfile
   pnpm build && pnpm typecheck && pnpm lint:deps && pnpm test && pnpm test:scripts
   ```
2. **Bump the version** in every `package.json` (keep them in lockstep) and update
   [`CHANGELOG.md`](../CHANGELOG.md): move items out of *Unreleased* into the new
   version with today's date.
3. **Commit** the version bump and **tag**:
   ```bash
   git commit -am "chore(release): vX.Y.Z"
   git tag vX.Y.Z
   git push origin master --tags
   ```
4. **Publish to npm.** `pnpm` skips `private` packages and rewrites `workspace:*`
   deps to the real version automatically:
   ```bash
   pnpm -r publish --access public
   # add --no-git-checks only if publishing from a non-tag state on purpose
   ```
5. **Cut the GitHub release** using the changelog entry as the body:
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[/p' CHANGELOG.md)
   ```
6. **(Optional) publish Docker images** for the app:
   ```bash
   docker build --target server -t ghcr.io/khoi03/makedown-server:X.Y.Z .
   docker build --target web    -t ghcr.io/khoi03/makedown-web:X.Y.Z .
   docker push ghcr.io/khoi03/makedown-server:X.Y.Z
   docker push ghcr.io/khoi03/makedown-web:X.Y.Z
   ```

## Verify the publish

```bash
npm view @makedown/cli version
npx @makedown/cli@latest --help     # or: npm i -g @makedown/cli && md --help
```

## Notes

- The visual-regression baselines (`packages/web/e2e/*-snapshots`) are
  `chromium-win32`; CI skips them on Linux. Regenerate after intentional UI
  changes with `--update-snapshots` on the baseline platform.
- Keep the `build.md` format changes reflected in [`SPEC.md`](../SPEC.md) and note
  them in the changelog.
