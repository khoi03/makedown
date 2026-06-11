/**
 * Binds the abstract sync protocol to real WebSockets (`ws`). The room logic in
 * sync-server.ts is transport-agnostic and fully unit-tested; this file is the
 * thin glue that turns a `ws` socket into a {@link SyncConnection}.
 */
import type { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import { RoomRegistry, type SyncConnection } from "./sync-server.js";

/** `ws` delivers binary frames as Buffer, ArrayBuffer, or Buffer[]. Normalize. */
function toUint8Array(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Default: derive the workspace id from the request path `/sync/<id>`. */
export function workspaceIdFromPath(req: IncomingMessage): string | undefined {
  const url = req.url ?? "";
  const match = /\/sync\/([^/?#]+)/.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export interface WebSocketAdapterOptions {
  /** Resolve a workspace id from the upgrade request. Defaults to the URL path. */
  readonly resolveWorkspaceId?: (req: IncomingMessage) => string | undefined;
}

/**
 * Wire a `ws` server to the room registry. Each connection joins its workspace's
 * room; messages are forwarded both ways; presence is cleaned up on close.
 */
export function attachWebSocketServer(
  wss: WebSocketServer,
  registry: RoomRegistry,
  opts: WebSocketAdapterOptions = {},
): void {
  const resolveId = opts.resolveWorkspaceId ?? workspaceIdFromPath;

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const workspaceId = resolveId(req);
    if (!workspaceId) {
      socket.close(1008, "missing workspace id");
      return;
    }

    const room = registry.get(workspaceId);
    const conn: SyncConnection = {
      send: (data: Uint8Array): void => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      },
    };
    const disconnect = room.connect(conn);

    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        room.receive(conn, toUint8Array(data));
      } catch {
        // A malformed frame must not take down the socket or the room.
        socket.close(1003, "invalid sync frame");
      }
    });
    socket.on("close", disconnect);
    socket.on("error", disconnect);
  });
}
