# Security Policy

## Supported versions

Makedown is pre-1.0. Security fixes target the latest released version and `main`.

| Version | Supported |
|---|---|
| 0.1.x | ✅ |
| < 0.1 | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's
[private vulnerability reporting](https://github.com/khoi03/makedown/security/advisories/new)
(Security → Advisories → "Report a vulnerability"). Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal `build.md` or request, if relevant),
- affected version/commit, and any suggested fix.

We aim to acknowledge reports within a few days and will keep you updated on the
fix and disclosure timeline. Please give us reasonable time to release a fix before
any public disclosure.

## Scope and hardening notes

Makedown executes workspace-defined code and talks to model providers, so a few
areas are especially security-relevant:

- **`transform` / `agent` steps run code.** Inputs, outputs, and scripts are
  confined to the workspace (`..`, absolute paths, and escaping symlinks are
  rejected). `transform` runs in a locked-down subprocess by default (no ambient
  filesystem, no inherited secrets, memory + time caps) or in Docker with
  `--network none`. Treat a workspace as you would any code you run.
- **The single-tenant server has no auth.** With no `DATABASE_URL`, run it locally
  or on a trusted network only. Enable teams (auth + RBAC) for shared deployments
  and front it with HTTPS + a rate-limiting proxy.
- **Share links are public.** Anyone with a `/s/<token>` URL can read the artifact
  (and provenance, if included). Revoke promptly and only share safe content.
- **Secrets** live in workspace `.env` files (gitignored) or the process
  environment — never commit them, and never paste a key into a prompt body.

Thank you for helping keep Makedown and its users safe.
