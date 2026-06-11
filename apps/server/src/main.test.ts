import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { encodeSyncStep1, readMessage, type SyncConnection } from "@makedown/sync";
import { start, type RunningServer } from "./main.js";

const exec = promisify(execFile);

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
});
