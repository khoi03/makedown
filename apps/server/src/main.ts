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
  restoreDocState,
  attachWebSocketServer,
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
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

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
    docs.set(id, doc);
    const dir = store.resolve(id);
    // Attach persistence only AFTER the initial load so loading from disk does
    // not get echoed back as a "change" (and never clobbers disk with an empty
    // doc before it has loaded).
    const attachPersistence = (): void => {
      persistences.set(id, new WorkspacePersistence(doc, dir, { author: opts.author }));
    };
    // Restore the CRDT state FIRST (stable history, idempotent reconnects), THEN
    // reconcile with the on-disk text — a no-op when they already match, a clean
    // replace when the text changed out-of-band (e.g. a git branch switch).
    // Order matters: text-loading before restoring would create a duplicate insert.
    void (async () => {
      await restoreDocState(doc, dir);
      await loadIntoDoc(doc, dir);
    })().then(attachPersistence, attachPersistence);
    return doc;
  }

  const registry = new RoomRegistry({
    createDoc: (id) => liveDoc(id),
    onDispose: (id) => {
      // Last client left: flush, then release the doc + persistence so a
      // long-running server doesn't accumulate observers for every workspace
      // ever opened. A later reopen recreates and reloads them.
      const persistence = persistences.get(id);
      if (persistence) {
        void persistence.flush().finally(() => persistence.destroy());
      }
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
    flushWorkspace: async (id) => {
      await persistences.get(id)?.flush();
    },
    reloadWorkspace: async (id) => {
      const doc = docs.get(id);
      if (doc) await loadIntoDoc(doc, store.resolve(id));
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

  // Auth/RBAC is opt-in: set DATABASE_URL to a Postgres instance to enable it.
  // Without it the server runs single-tenant (no login), exactly as before.
  const databaseUrl = process.env["DATABASE_URL"];
  const secureCookies = process.env["MAKEDOWN_SECURE_COOKIES"] === "1";
  let tenancy: TenancyProvider = new NullTenancy();
  // Sharing is durable in both modes: Postgres when a database is configured,
  // otherwise a file-backed registry under the workspaces root (the default).
  let sharing: SharingService | undefined;
  if (databaseUrl) {
    const pg = await createPostgresTenancy(databaseUrl);
    tenancy = pg.tenancy;
    sharing = pg.sharing;
  }

  const server = await start({ workspacesRoot, port, logger: true, tenancy, sharing, secureCookies });
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
