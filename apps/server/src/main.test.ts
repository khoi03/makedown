import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  encodeSyncStep1,
  encodeSyncUpdate,
  readMessage,
  getBuildText,
  type SyncConnection,
} from "@makedown/sync";
import { start, createServer, parseRateLimitPerMinute, type RunningServer } from "./main.js";

const exec = promisify(execFile);

describe("parseRateLimitPerMinute", () => {
  it("returns undefined when unset or blank (route default applies)", () => {
    expect(parseRateLimitPerMinute(undefined)).toBeUndefined();
    expect(parseRateLimitPerMinute("")).toBeUndefined();
    expect(parseRateLimitPerMinute("   ")).toBeUndefined();
  });

  it("parses a positive integer as max-per-minute", () => {
    expect(parseRateLimitPerMinute("120")).toEqual({ max: 120, windowMs: 60_000 });
    expect(parseRateLimitPerMinute("60.9")).toEqual({ max: 60, windowMs: 60_000 });
  });

  it("ignores non-positive or non-numeric values (falls back to the default)", () => {
    expect(parseRateLimitPerMinute("0")).toBeUndefined();
    expect(parseRateLimitPerMinute("-5")).toBeUndefined();
    expect(parseRateLimitPerMinute("abc")).toBeUndefined();
  });
});

describe("server end-to-end", () => {
  let root: string;
  let server: RunningServer;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mde2e-"));
    const dir = join(root, "demo");
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "build.md"), "# live\n\ncollaborative build spec", "utf8");
    await exec("git", ["init", "-b", "main"], { cwd: dir });
    server = await start({ workspacesRoot: root, port: 0, host: "127.0.0.1" });
  });
  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  it("serves the HTTP API", async () => {
    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const list = (await (await fetch(`${server.url}/api/workspaces`)).json()) as {
      workspaces: string[];
    };
    expect(list.workspaces).toContain("demo");
  });

  it("syncs a workspace's live build.md over the mounted WebSocket", async () => {
    const wsUrl = server.url.replace("http", "ws");
    const clientDoc = new Y.Doc();
    const awareness = new Awareness(clientDoc);
    const socket = new WebSocket(`${wsUrl}/sync/demo`);
    socket.binaryType = "arraybuffer";
    const conn: SyncConnection = { send: (d) => socket.send(d) };

    try {
      socket.on("message", (data: ArrayBuffer) => {
        const reply = readMessage(clientDoc, awareness, new Uint8Array(data), conn);
        if (reply) socket.send(reply);
      });
      await new Promise<void>((resolve, reject) => {
        socket.on("open", () => socket.send(encodeSyncStep1(clientDoc)));
        socket.on("error", reject);
        clientDoc.on("update", () => {
          if (clientDoc.getText("build.md").toString().includes("collaborative")) resolve();
        });
        setTimeout(() => reject(new Error("timeout waiting for sync")), 4000);
      });
      expect(clientDoc.getText("build.md").toString()).toContain("collaborative build spec");
    } finally {
      socket.close();
    }
  });

  it("does not scramble build.md across edit → disconnect → reconnect (the reload repro)", async () => {
    const wsUrl = server.url.replace("http", "ws");
    const TARGET = "model: anthropic:cc/claude-sonnet-4-6";

    /** Connect a client, run the y-sync handshake, resolve once build.md is seeded. */
    const connect = (): { doc: Y.Doc; socket: WebSocket; synced: Promise<void> } => {
      const doc = new Y.Doc();
      const awareness = new Awareness(doc);
      const socket = new WebSocket(`${wsUrl}/sync/demo`);
      socket.binaryType = "arraybuffer";
      const conn: SyncConnection = { send: (d) => socket.send(d) };
      socket.on("message", (data: ArrayBuffer) => {
        const reply = readMessage(doc, awareness, new Uint8Array(data), conn);
        if (reply) socket.send(reply);
      });
      // Propagate this client's *local* edits to the server (origin !== conn);
      // remote updates applied by readMessage carry origin === conn and are skipped.
      doc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin !== conn && socket.readyState === socket.OPEN) {
          socket.send(encodeSyncUpdate(update));
        }
      });
      const synced = new Promise<void>((resolve, reject) => {
        socket.on("open", () => socket.send(encodeSyncStep1(doc)));
        socket.on("error", reject);
        doc.on("update", () => {
          const t = doc.getText("build.md").toString();
          if (t.includes("collaborative") || t.includes("sonnet")) resolve();
        });
        setTimeout(() => reject(new Error("timeout waiting for sync")), 4000);
      });
      return { doc, socket, synced };
    };

    // 1. Client A connects, gets the seed, and replaces build.md (like a UI edit).
    const a = connect();
    await a.synced;
    const aText = a.doc.getText("build.md");
    aText.delete(0, aText.length);
    aText.insert(0, TARGET);
    await new Promise((r) => setTimeout(r, 200)); // edit reaches the server

    // 2. A disconnects → room empties → server flushSync's to disk + ydoc.bin.
    a.socket.close();
    await new Promise((r) => setTimeout(r, 400));
    expect(await readFile(join(root, "demo", "build.md"), "utf8")).toBe(TARGET);

    // 3. A fresh client B reconnects — this is the page reload.
    const b = connect();
    await b.synced;
    await new Promise((r) => setTimeout(r, 200));
    try {
      expect(b.doc.getText("build.md").toString()).toBe(TARGET);
    } finally {
      b.socket.close();
    }
  });
});

/**
 * Regression tests for the "edit build.md → reload → scrambled text" bug.
 *
 * The room lifecycle must load and persist a workspace doc *synchronously at its
 * boundaries*, so a reconnecting client never syncs against a half-loaded doc and
 * a reopen never reads half-written state. These drive `createServer` directly
 * (no listening socket) to exercise the open/edit/dispose/reopen sequence
 * deterministically.
 */
describe("workspace doc lifecycle (reload-scramble regression)", () => {
  let root: string;
  const MODEL_LINE = "model: anthropic:cc/claude-sonnet-4-6\n";
  /** A no-op sync connection: enough to register/deregister a room client. */
  const noopConn: SyncConnection = { send: () => {} };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdlife-"));
    const dir = join(root, "demo");
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "build.md"), "# original\n\nfirst draft", "utf8");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads build.md into the doc synchronously, before any client can sync it", () => {
    const { registry, dispose } = createServer({ workspacesRoot: root });
    try {
      // get() builds the room + its doc; a client could connect on the very next
      // tick, so the doc must already carry its on-disk content right here.
      const room = registry.get("demo");
      expect(getBuildText(room.doc).toString()).toBe("# original\n\nfirst draft");
    } finally {
      dispose();
    }
  });

  it("flushes the edited build.md to disk synchronously when the last client leaves", async () => {
    const { registry, dispose } = createServer({ workspacesRoot: root });
    try {
      const room = registry.get("demo");
      const off = room.connect(noopConn);
      const text = getBuildText(room.doc);
      text.delete(0, text.length);
      text.insert(0, MODEL_LINE);

      off(); // last client leaves → dispose must persist before returning

      const onDisk = await readFile(join(root, "demo", "build.md"), "utf8");
      expect(onDisk).toBe(MODEL_LINE);
    } finally {
      dispose();
    }
  });

  it("preserves build.md verbatim across a close/reopen cycle (no CRDT interleave)", () => {
    const { registry, dispose } = createServer({ workspacesRoot: root });
    try {
      const first = registry.get("demo");
      const off = first.connect(noopConn);
      const text = getBuildText(first.doc);
      text.delete(0, text.length);
      text.insert(0, MODEL_LINE);
      off(); // close the room (persist)

      // Reopen: the fresh doc must restore exactly what was saved — verbatim,
      // not a scrambled merge of the old and reconciled histories.
      const reopened = registry.get("demo");
      expect(getBuildText(reopened.doc).toString()).toBe(MODEL_LINE);
    } finally {
      dispose();
    }
  });

  it("treats restored CRDT state as authoritative — a divergent build.md on disk does not override it", () => {
    // Establish a saved CRDT state holding the CORRECT text.
    {
      const { registry, dispose } = createServer({ workspacesRoot: root });
      try {
        const room = registry.get("demo");
        const off = room.connect(noopConn);
        const text = getBuildText(room.doc);
        text.delete(0, text.length);
        text.insert(0, MODEL_LINE);
        off(); // flushSync → ydoc.bin + build.md both = MODEL_LINE
      } finally {
        dispose();
      }
    }
    // Simulate build.md drifting out-of-band (e.g. an earlier scramble left a bad
    // file on disk while the saved CRDT state still holds the good text). The
    // restored state is the source of truth; reconciling it back to the bad disk
    // — a delete+insert — is exactly what re-corrupted the doc.
    writeFileSync(join(root, "demo", "build.md"), "model: anthropic:cc/SCRAMBLEDtext\n", "utf8");

    {
      const { registry, dispose } = createServer({ workspacesRoot: root });
      try {
        const reopened = registry.get("demo");
        expect(getBuildText(reopened.doc).toString()).toBe(MODEL_LINE);
      } finally {
        dispose();
      }
    }
  });
});
