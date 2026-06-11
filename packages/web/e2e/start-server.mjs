/**
 * E2E server launcher: copy the fixture workspace(s) into a throwaway temp dir
 * (so the build's disk writes never touch the repo) and start the real
 * @makedown/server. Playwright's webServer waits for the port to come up.
 *
 * Requires the server package to be built (`pnpm --filter @makedown/server build`).
 */
import { mkdtemp, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Imported by relative path to the built server on purpose: @makedown/web must
// not declare a dependency on the server (it's a browser bundle). This launcher
// is a dev-only Node script, never shipped to the client.
import { start } from "../../../apps/server/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(join(tmpdir(), "md-e2e-"));
await cp(join(here, "fixtures"), root, { recursive: true });

const port = Number(process.env["E2E_SERVER_PORT"] ?? "4100");
const server = await start({ workspacesRoot: root, port, host: "127.0.0.1" });
// eslint-disable-next-line no-console
console.log(`[e2e] server listening ${server.url} (workspaces: ${root})`);
