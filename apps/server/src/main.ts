/**
 * Server bootstrap: assembles the HTTP API, the per-workspace live docs + git
 * persistence, and mounts the realtime sync WebSocket on the same HTTP server.
 *
 * The live Y.Doc per workspace is the collaborative truth; WorkspacePersistence
 * debounce-materializes it to disk so the engine builds fresh text, and the API
 * flushes it on demand before a build/snapshot.
 */
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import type { FastifyInstance } from "fastify";
import {
  RoomRegistry,
  WorkspacePersistence,
  loadIntoDoc,
  applySnapshot,
  readWorkspaceFromDiskSync,
  restoreDocStateSync,
  attachWebSocketServer,
  getSourceText,
  type GitAuthor,
} from "@makedown/sync";
import { WorkspaceStore } from "./workspace.js";
import { BuildManager } from "./builds.js";
import { buildApi } from "./api.js";
import { NullTenancy, createPostgresTenancy, type TenancyProvider } from "./tenancy/index.js";
import { SharingService, FileShareStore } from "./sharing/index.js";

export interface ServerOptions {
  readonly workspacesRoot: string;
  readonly port?: number;
  readonly host?: string;
  readonly author?: GitAuthor;
  readonly logger?: boolean;
  /** Auto-deny an approval after this many ms. Default: 10 minutes. */
  readonly approvalTimeoutMs?: number;
  /** Tenancy provider (auth/RBAC). Defaults to single-tenant NullTenancy. */
  readonly tenancy?: TenancyProvider;
  /**
   * Sharing service (public read-only artifact links). Defaults to a durable
   * file-backed store under the workspaces root, so single-tenant self-hosts get
   * persistent links with no database.
   */
  readonly sharing?: SharingService;
  /** Set Secure on the session cookie (HTTPS deployments). */
  readonly secureCookies?: boolean;
  /** Override the analytics read rate limit. Defaults to the route's 60/min/IP. */
  readonly analyticsRateLimit?: { readonly max: number; readonly windowMs: number };
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Parse a "max requests per minute" env value into a rate-limit config. Returns
 * undefined when unset, blank, non-numeric, or non-positive — so the route's own
 * default applies rather than the server failing to start on a typo.
 */
export function parseRateLimitPerMinute(
  value: string | undefined,
): { max: number; windowMs: number } | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const max = Number(value);
  if (!Number.isFinite(max) || max <= 0) return undefined;
  return { max: Math.floor(max), windowMs: RATE_LIMIT_WINDOW_MS };
}

export interface AssembledServer {
  readonly app: FastifyInstance;
  readonly registry: RoomRegistry;
  readonly manager: BuildManager;
  /** Cancel all debounce timers + detach observers (clean shutdown). */
  dispose(): void;
}

/**
 * Wire the server without listening — for tests and for `start`. Manages one
 * live Y.Doc + persistence per workspace, shared between the sync rooms and the
 * API's flush/reload hooks.
 */
export function createServer(opts: ServerOptions): AssembledServer {
  const store = new WorkspaceStore(opts.workspacesRoot);
  const manager = new BuildManager({
    approvalTimeoutMs: opts.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
  });
  // Durable by default: a file-backed registry under the workspaces root, so
  // single-tenant self-hosts get persistent share links with no database.
  const sharing = opts.sharing ?? new SharingService(new FileShareStore(opts.workspacesRoot));

  const docs = new Map<string, Y.Doc>();
  const persistences = new Map<string, WorkspacePersistence>();

  /** Get-or-create the live doc for a workspace, loading it from disk once. */
  function liveDoc(id: string): Y.Doc {
    const existing = docs.get(id);
    if (existing) return existing;
    const doc = new Y.Doc();
    const dir = store.resolve(id);
    // Load the doc FULLY and SYNCHRONOUSLY before it is exposed to any room or
    // client. The previous fire-and-forget async load let a reconnecting client
    // sync against an empty doc and then race the load, scrambling text on reload.
    //
    // The saved CRDT state is AUTHORITATIVE: `flush` always writes ydoc.bin and
    // build.md together, so a restored doc already holds the latest text *and* a
    // single stable history (idempotent reconnects). We deliberately do NOT
    // reconcile to disk after a successful restore — that reconcile is a
    // `replaceText` (delete+insert), which both lets a stale/corrupt build.md
    // override the good state and seeds divergent ops that interleave into
    // scrambled text. Only when there is no saved state (a true first open) do we
    // seed from disk. Out-of-band disk/branch changes are applied to the live doc
    // explicitly via switchBranch / the reload hook, not silently at open.
    if (!restoreDocStateSync(doc, dir)) {
      applySnapshot(doc, readWorkspaceFromDiskSync(dir));
    }
    docs.set(id, doc);
    // Attach persistence only now, so the initial load is not echoed as an edit.
    persistences.set(id, new WorkspacePersistence(doc, dir, { author: opts.author }));
    return doc;
  }

  const registry = new RoomRegistry({
    createDoc: (id) => liveDoc(id),
    onDispose: (id) => {
      // Last client left: persist SYNCHRONOUSLY, then release the doc +
      // persistence so a long-running server doesn't accumulate observers for
      // every workspace ever opened. Synchronous so a dispose-then-immediate-
      // reopen can never observe half-written state (the reload-scramble bug);
      // a later reopen recreates and reloads from the consistent final state.
      const persistence = persistences.get(id);
      persistence?.flushSync();
      persistence?.destroy();
      persistences.delete(id);
      docs.delete(id);
    },
  });

  const app = buildApi({
    store,
    manager,
    author: opts.author,
    logger: opts.logger,
    tenancy: opts.tenancy ?? new NullTenancy(),
    sharing,
    secureCookies: opts.secureCookies,
    analyticsRateLimit: opts.analyticsRateLimit,
    flushWorkspace: async (id) => {
      await persistences.get(id)?.flush();
    },
    reloadWorkspace: async (id) => {
      const doc = docs.get(id);
      if (doc) await loadIntoDoc(doc, store.resolve(id));
    },
    // Surgically insert a just-imported source into the live doc (if a room is
    // open) so connected editors see it at once. Deliberately NOT a full reload:
    // touching only this one Y.Text never clobbers unsaved build.md edits. If no
    // room is open the file is still on disk; the next room open loads it.
    addSourceToWorkspace: (id, relPath, markdown) => {
      const doc = docs.get(id);
      if (!doc) return;
      const text = getSourceText(doc, relPath);
      doc.transact(() => {
        text.delete(0, text.length);
        text.insert(0, markdown);
      });
    },
  });

  const dispose = (): void => {
    for (const persistence of persistences.values()) persistence.destroy();
    persistences.clear();
    docs.clear();
  };

  return { app, registry, manager, dispose };
}

export interface RunningServer extends AssembledServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Assemble, listen, and mount the sync WebSocket. */
export async function start(opts: ServerOptions): Promise<RunningServer> {
  const { app, registry, manager, dispose } = createServer(opts);
  await app.listen({ port: opts.port ?? 4000, host: opts.host ?? "127.0.0.1" });

  const wss = new WebSocketServer({ server: app.server, path: undefined });
  attachWebSocketServer(wss, registry);

  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  const url = `http://${opts.host ?? "127.0.0.1"}:${port}`;

  return {
    app,
    registry,
    manager,
    dispose,
    url,
    close: async () => {
      // Cancel all debounce timers FIRST so no flush fires after teardown
      // (otherwise a pending materialize/state-write races shutdown + cleanup).
      dispose();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await app.close();
    },
  };
}

/** CLI entrypoint: read config from the environment and start listening. */
async function main(): Promise<void> {
  const workspacesRoot = process.env["MAKEDOWN_WORKSPACES_ROOT"] ?? process.cwd();
  const port = Number(process.env["PORT"] ?? 4000);
  // Bind loopback by default (safe for local runs); set HOST=0.0.0.0 to accept
  // connections from other containers/hosts (e.g. behind the Docker nginx proxy).
  const host = process.env["HOST"] ?? "127.0.0.1";

  // Auth/RBAC is opt-in: set DATABASE_URL to a Postgres instance to enable it.
  // Without it the server runs single-tenant (no login), exactly as before.
  const databaseUrl = process.env["DATABASE_URL"];
  const secureCookies = process.env["MAKEDOWN_SECURE_COOKIES"] === "1";
  // Optional: cap analytics reads per IP per minute (default 60). Invalid → default.
  const analyticsRateLimit = parseRateLimitPerMinute(process.env["MAKEDOWN_ANALYTICS_RATE_LIMIT"]);
  let tenancy: TenancyProvider = new NullTenancy();
  // Sharing is durable in both modes: Postgres when a database is configured,
  // otherwise a file-backed registry under the workspaces root (the default).
  let sharing: SharingService | undefined;
  if (databaseUrl) {
    const pg = await createPostgresTenancy(databaseUrl);
    tenancy = pg.tenancy;
    sharing = pg.sharing;
  }

  const server = await start({
    workspacesRoot,
    port,
    host,
    logger: true,
    tenancy,
    sharing,
    secureCookies,
    analyticsRateLimit,
  });
  // eslint-disable-next-line no-console
  console.log(
    `Makedown server listening on ${server.url} (workspaces: ${workspacesRoot}, auth: ${tenancy.enabled ? "on" : "off"})`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
