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
  attachWebSocketServer,
  type GitAuthor,
} from "@makedown/sync";
import { WorkspaceStore } from "./workspace.js";
import { BuildManager } from "./builds.js";
import { buildApi } from "./api.js";

export interface ServerOptions {
  readonly workspacesRoot: string;
  readonly port?: number;
  readonly host?: string;
  readonly author?: GitAuthor;
  readonly logger?: boolean;
  /** Auto-deny an approval after this many ms. Default: 10 minutes. */
  readonly approvalTimeoutMs?: number;
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export interface AssembledServer {
  readonly app: FastifyInstance;
  readonly registry: RoomRegistry;
  readonly manager: BuildManager;
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
    loadIntoDoc(doc, dir).then(attachPersistence, attachPersistence);
    return doc;
  }

  const registry = new RoomRegistry({
    createDoc: (id) => liveDoc(id),
    onDispose: (id) => {
      void persistences.get(id)?.flush();
    },
  });

  const app = buildApi({
    store,
    manager,
    author: opts.author,
    logger: opts.logger,
    flushWorkspace: async (id) => {
      await persistences.get(id)?.flush();
    },
    reloadWorkspace: async (id) => {
      const doc = docs.get(id);
      if (doc) await loadIntoDoc(doc, store.resolve(id));
    },
  });

  return { app, registry, manager };
}

export interface RunningServer extends AssembledServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Assemble, listen, and mount the sync WebSocket. */
export async function start(opts: ServerOptions): Promise<RunningServer> {
  const { app, registry, manager } = createServer(opts);
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
    url,
    close: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await app.close();
    },
  };
}

/** CLI entrypoint: read config from the environment and start listening. */
async function main(): Promise<void> {
  const workspacesRoot = process.env["MAKEDOWN_WORKSPACES_ROOT"] ?? process.cwd();
  const port = Number(process.env["PORT"] ?? 4000);
  const server = await start({ workspacesRoot, port, logger: true });
  // eslint-disable-next-line no-console
  console.log(`Makedown server listening on ${server.url} (workspaces: ${workspacesRoot})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
