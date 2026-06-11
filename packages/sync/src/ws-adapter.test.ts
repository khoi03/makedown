import { afterEach, describe, it, expect } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { RoomRegistry, encodeSyncStep1, readMessage, type SyncConnection } from "./sync-server.js";
import { attachWebSocketServer, workspaceIdFromPath } from "./ws-adapter.js";

describe("workspaceIdFromPath", () => {
  it("extracts the id from /sync/<id>", () => {
    expect(workspaceIdFromPath({ url: "/sync/my-workspace" } as never)).toBe("my-workspace");
  });
  it("decodes percent-encoding and ignores query strings", () => {
    expect(workspaceIdFromPath({ url: "/sync/a%20b?token=x" } as never)).toBe("a b");
  });
  it("returns undefined when no id is present", () => {
    expect(workspaceIdFromPath({ url: "/sync/" } as never)).toBeUndefined();
    expect(workspaceIdFromPath({ url: "/other" } as never)).toBeUndefined();
  });
});

describe("attachWebSocketServer (real sockets)", () => {
  let wss: WebSocketServer;
  let clients: WebSocket[] = [];

  afterEach(async () => {
    for (const c of clients) c.close();
    clients = [];
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  function start(registry: RoomRegistry): Promise<number> {
    wss = new WebSocketServer({ port: 0 });
    attachWebSocketServer(wss, registry);
    return new Promise((resolve) =>
      wss.on("listening", () => resolve((wss.address() as AddressInfo).port)),
    );
  }

  it("syncs a seeded room's content to a real WebSocket client", async () => {
    const registry = new RoomRegistry({
      createDoc: () => {
        const doc = new Y.Doc();
        doc.getText("build.md").insert(0, "over the wire");
        return doc;
      },
    });
    const port = await start(registry);

    const clientDoc = new Y.Doc();
    const clientAwareness = new Awareness(clientDoc);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/sync/demo`);
    socket.binaryType = "arraybuffer";
    clients.push(socket);

    const conn: SyncConnection = { send: (d) => socket.send(d) };
    socket.on("message", (data: ArrayBuffer) => {
      const reply = readMessage(clientDoc, clientAwareness, new Uint8Array(data), conn);
      if (reply) socket.send(reply);
    });

    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => socket.send(encodeSyncStep1(clientDoc)));
      socket.on("error", reject);
      clientDoc.on("update", () => {
        if (clientDoc.getText("build.md").toString() === "over the wire") resolve();
      });
      setTimeout(() => reject(new Error("timeout waiting for sync")), 3000);
    });

    expect(clientDoc.getText("build.md").toString()).toBe("over the wire");
  });

  it("rejects a connection with no workspace id", async () => {
    const registry = new RoomRegistry();
    const port = await start(registry);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/sync/`);
    clients.push(socket);

    const code = await new Promise<number>((resolve, reject) => {
      socket.on("close", (c) => resolve(c));
      socket.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 3000);
    });
    expect(code).toBe(1008);
  });
});
