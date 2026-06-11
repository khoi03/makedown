# sandbox-demo — Phase 1.5 isolation, hands-on

Five tiny workspaces that show how Makedown runs untrusted `build.md` safely.
Every target is a zero-token `transform` step, so **none of these need an API key**
(`transform` is deterministic "code where code is enough").

Build the CLI once, then run each workspace:

```bash
pnpm -r build
# the CLI is:  node packages/cli/dist/index.js build <dir>
```

| Run | Expected | Shows |
|---|---|---|
| `build examples/sandbox-demo/safe` | ✓ builds → `artifacts/safe.txt` = `APPLES / …` | A pure transform runs fine in the default subprocess sandbox |
| `build examples/sandbox-demo/blocked` | ✗ `Access to this API has been restricted` | The sandbox **denies filesystem** access (and scrubs secrets from `env`) to a malicious script |
| `build examples/sandbox-demo/trusted` | ✓ builds — artifact contains a host file | `sandbox: none` is the **trusted in-process escape hatch**: the *same* `evil.mjs`, now with full access. Use only for a `build.md` you wrote |
| `build examples/sandbox-demo/escape` | ✗ `Path "…" escapes the workspace root` | The **path-traversal guard** rejects an output that leaves the workspace |
| `build examples/sandbox-demo/container` | ✓ builds inside Docker (`--network none`) | The strongest isolation. Needs Docker running; without it you get an actionable "is Docker running?" error |

`blocked` and `escape` are **meant to fail** — that failure is the feature working.

The contrast to notice: `blocked` and `trusted` run the *identical* `evil.mjs`. Under
the default sandbox it's blocked; under `sandbox: none` it has full access. That is the
trust boundary: sandboxed by default, opt out only for code you control.

> `sandbox: container` runs the script in Docker with `--network none`, only the
> script mounted read-only, and CPU/memory/PID caps — the one level that also
> blocks network (Node's permission-model sandbox can't). Default image:
> `node:lts-alpine` (`docker pull node:lts-alpine` once to enable it).
