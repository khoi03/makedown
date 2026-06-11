import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  WorkspaceRoom,
  RoomRegistry,
  encodeSyncStep1,
  encodeSyncUpdate,
  encodeAwarenessMessage,
  readMessage,
  type SyncConnection,
} from "./sync-server.js";

/**
 * An in-process client that speaks the same wire protocol as a browser. Lets us
 * verify convergence + awareness through the room with no real sockets.
 */
class TestPeer {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly conn: SyncConnection;
  private readonly disconnect: () => void;

  constructor(room: WorkspaceRoom) {
    this.conn = {
      send: (data: Uint8Array): void => {
        const reply = readMessage(this.doc, this.awareness, data, this.conn);
        if (reply) room.receive(this.conn, reply);
      },
    };
    // Propagate our local edits to the room.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this.conn) return; // came from the server; don't echo
      room.receive(this.conn, encodeSyncUpdate(update));
    });
    // Propagate our local presence to the room.
    this.awareness.on("update", (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === this.conn) return; // applied from the server; don't echo
      const clients = [...changes.added, ...changes.updated, ...changes.removed];
      room.receive(this.conn, encodeAwarenessMessage(this.awareness, clients));
    });
    this.disconnect = room.connect(this.conn);
    // Client also initiates a sync handshake (as a real WebsocketProvider does).
    room.receive(this.conn, encodeSyncStep1(this.doc));
  }

  leave(): void {
    this.disconnect();
  }
}

describe("WorkspaceRoom", () => {
  it("delivers an existing room's content to a newly connected peer", () => {
    const room = new WorkspaceRoom();
    room.doc.getText("build.md").insert(0, "seeded");

    const peer = new TestPeer(room);
    expect(peer.doc.getText("build.md").toString()).toBe("seeded");
  });

  it("propagates one peer's edit to another peer", () => {
    const room = new WorkspaceRoom();
    const a = new TestPeer(room);
    const b = new TestPeer(room);

    a.doc.getText("build.md").insert(0, "hello");

    expect(b.doc.getText("build.md").toString()).toBe("hello");
    expect(room.doc.getText("build.md").toString()).toBe("hello");
  });

  it("converges concurrent edits from two peers", () => {
    const room = new WorkspaceRoom();
    const a = new TestPeer(room);
    const b = new TestPeer(room);

    a.doc.getText("build.md").insert(0, "AAA");
    b.doc.getText("build.md").insert(0, "BBB");

    expect(a.doc.getText("build.md").toString()).toBe(b.doc.getText("build.md").toString());
    expect(a.doc.getText("build.md").toString()).toContain("AAA");
    expect(a.doc.getText("build.md").toString()).toContain("BBB");
  });

  it("shares awareness (presence) between peers", () => {
    const room = new WorkspaceRoom();
    const a = new TestPeer(room);
    const b = new TestPeer(room);

    a.awareness.setLocalStateField("user", { name: "Ada", color: "#f0f" });

    const seen = [...b.awareness.getStates().values()].map((s) => s["user"]);
    expect(seen).toContainEqual({ name: "Ada", color: "#f0f" });
  });

  it("clears a peer's awareness when it disconnects", () => {
    const room = new WorkspaceRoom();
    const a = new TestPeer(room);
    const b = new TestPeer(room);
    a.awareness.setLocalStateField("user", { name: "Ada" });
    expect(b.awareness.getStates().size).toBeGreaterThanOrEqual(2);

    a.leave();
    const names = [...b.awareness.getStates().values()].map((s) => s["user"]?.name);
    expect(names).not.toContain("Ada");
  });

  it("tracks connection count and reports empty", () => {
    const room = new WorkspaceRoom();
    expect(room.isEmpty()).toBe(true);
    const a = new TestPeer(room);
    expect(room.connectionCount).toBe(1);
    a.leave();
    expect(room.isEmpty()).toBe(true);
  });
});

describe("RoomRegistry", () => {
  it("returns the same room per workspace id and distinct rooms for different ids", () => {
    const registry = new RoomRegistry();
    const r1 = registry.get("ws-1");
    const r2 = registry.get("ws-1");
    const r3 = registry.get("ws-2");
    expect(r1).toBe(r2);
    expect(r1).not.toBe(r3);
  });

  it("invokes the doc factory so a room can be seeded from persistence", () => {
    const registry = new RoomRegistry({
      createDoc: (id) => {
        const doc = new Y.Doc();
        doc.getText("build.md").insert(0, `seed:${id}`);
        return doc;
      },
    });
    expect(registry.get("abc").doc.getText("build.md").toString()).toBe("seed:abc");
  });

  it("disposes a room when its last connection leaves", () => {
    const registry = new RoomRegistry();
    const room = registry.get("ws-1");
    const conn: SyncConnection = { send: () => {} };
    const disconnect = room.connect(conn);
    expect(registry.has("ws-1")).toBe(true);
    disconnect();
    expect(registry.has("ws-1")).toBe(false);
  });
});
