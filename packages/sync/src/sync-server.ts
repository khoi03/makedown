/**
 * The collaboration sync server: the y-websocket wire protocol over an abstract
 * {@link SyncConnection}, a {@link WorkspaceRoom} per workspace, and a
 * {@link RoomRegistry}. Keeping the transport abstract lets the protocol be
 * verified headlessly; {@link attachWebSocketServer} binds it to real sockets.
 */
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";

/** y-websocket message tags. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** A transport that can receive binary frames. Implemented by ws and by tests. */
export interface SyncConnection {
  send(data: Uint8Array): void;
}

/** Encode a sync step-1 (state vector) message. Sent on connect. */
export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** Encode a document update as a sync message for broadcast. */
export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** Encode an awareness (presence) update for the given clients. */
export function encodeAwarenessMessage(awareness: Awareness, clients: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, clients));
  return encoding.toUint8Array(encoder);
}

/**
 * Apply an incoming message to `doc`/`awareness`. Returns a reply frame to send
 * back to the sender (e.g. a sync step-2), or `null` when no reply is needed.
 * `origin` tags the resulting Yjs updates so the room won't echo them back.
 */
export function readMessage(
  doc: Y.Doc,
  awareness: Awareness,
  message: Uint8Array,
  origin: unknown,
): Uint8Array | null {
  const decoder = decoding.createDecoder(message);
  const encoder = encoding.createEncoder();
  const type = decoding.readVarUint(decoder);
  switch (type) {
    case MESSAGE_SYNC: {
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, origin);
      // length 1 == only the tag was written == nothing to reply.
      return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null;
    }
    case MESSAGE_AWARENESS: {
      applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), origin);
      return null;
    }
    default:
      return null;
  }
}

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] };

/**
 * One collaborative workspace: a Y.Doc + Awareness shared across all connected
 * clients. Broadcasts doc and presence updates; cleans up a client's presence
 * when it disconnects.
 */
export class WorkspaceRoom {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private readonly conns = new Set<SyncConnection>();
  /** Awareness client ids controlled by each connection, for cleanup on leave. */
  private readonly controlled = new Map<SyncConnection, Set<number>>();
  private hadConnections = false;

  constructor(
    doc?: Y.Doc,
    private readonly onEmpty?: () => void,
  ) {
    this.doc = doc ?? new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalState(null); // the server holds no presence of its own
    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  isEmpty(): boolean {
    return this.conns.size === 0;
  }

  /** Register a connection, send it the initial state, return a disconnect fn. */
  connect(conn: SyncConnection): () => void {
    this.conns.add(conn);
    this.hadConnections = true;
    conn.send(encodeSyncStep1(this.doc));
    const states = this.awareness.getStates();
    if (states.size > 0) {
      conn.send(encodeAwarenessMessage(this.awareness, [...states.keys()]));
    }
    return () => this.disconnect(conn);
  }

  /** Handle a frame received from a connection. */
  receive(conn: SyncConnection, message: Uint8Array): void {
    const reply = readMessage(this.doc, this.awareness, message, conn);
    if (reply) conn.send(reply);
  }

  private disconnect(conn: SyncConnection): void {
    if (!this.conns.delete(conn)) return;
    const ids = this.controlled.get(conn);
    if (ids && ids.size > 0) {
      removeAwarenessStates(this.awareness, [...ids], "disconnect");
    }
    this.controlled.delete(conn);
    if (this.conns.size === 0 && this.hadConnections) this.onEmpty?.();
  }

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    const message = encodeSyncUpdate(update);
    for (const conn of this.conns) {
      if (conn !== origin) conn.send(message);
    }
  };

  private readonly handleAwarenessUpdate = (change: AwarenessChange, origin: unknown): void => {
    if (origin && this.conns.has(origin as SyncConnection)) {
      const ids = this.controlled.get(origin as SyncConnection) ?? new Set<number>();
      change.added.forEach((id) => ids.add(id));
      change.updated.forEach((id) => ids.add(id));
      change.removed.forEach((id) => ids.delete(id));
      this.controlled.set(origin as SyncConnection, ids);
    }
    const clients = [...change.added, ...change.updated, ...change.removed];
    const message = encodeAwarenessMessage(this.awareness, clients);
    for (const conn of this.conns) {
      if (conn !== origin) conn.send(message);
    }
  };

  /** Tear down the room's listeners (called when disposed). */
  destroy(): void {
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.awareness.destroy();
  }
}

export interface RoomRegistryOptions {
  /** Seed a fresh room's doc (e.g. from git persistence). */
  readonly createDoc?: (workspaceId: string) => Y.Doc;
  /** Called when a room is disposed (last client left) — e.g. final persist. */
  readonly onDispose?: (workspaceId: string, room: WorkspaceRoom) => void;
}

/** Lazily creates and reaps one {@link WorkspaceRoom} per workspace id. */
export class RoomRegistry {
  private readonly rooms = new Map<string, WorkspaceRoom>();

  constructor(private readonly opts: RoomRegistryOptions = {}) {}

  has(workspaceId: string): boolean {
    return this.rooms.has(workspaceId);
  }

  /** Get (or lazily create) the room for a workspace. */
  get(workspaceId: string): WorkspaceRoom {
    let room = this.rooms.get(workspaceId);
    if (room) return room;
    const doc = this.opts.createDoc?.(workspaceId);
    room = new WorkspaceRoom(doc, () => this.dispose(workspaceId));
    this.rooms.set(workspaceId, room);
    return room;
  }

  private dispose(workspaceId: string): void {
    const room = this.rooms.get(workspaceId);
    if (!room) return;
    this.rooms.delete(workspaceId);
    this.opts.onDispose?.(workspaceId, room);
    room.destroy();
  }
}
