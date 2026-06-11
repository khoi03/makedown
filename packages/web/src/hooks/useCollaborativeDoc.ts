/**
 * Sets up a Yjs document synced to the server over y-websocket, with awareness
 * (presence) seeded with a stable local identity. One doc per workspace; torn
 * down on unmount or workspace change.
 */
import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface LocalUser {
  readonly name: string;
  readonly color: string;
}

export interface CollaborativeDoc {
  readonly doc: Y.Doc;
  readonly provider: WebsocketProvider | null;
  readonly status: ConnectionStatus;
}

const PRESENCE_COLORS = [
  "oklch(70% 0.18 280)",
  "oklch(72% 0.15 152)",
  "oklch(75% 0.15 60)",
  "oklch(68% 0.2 25)",
  "oklch(72% 0.15 200)",
  "oklch(70% 0.18 330)",
];

/** A stable, lightweight local identity for presence (no auth yet). */
export function makeLocalUser(): LocalUser {
  const n = Math.floor(Math.random() * 9000) + 1000;
  const color = PRESENCE_COLORS[n % PRESENCE_COLORS.length]!;
  return { name: `Guest ${n}`, color };
}

export function useCollaborativeDoc(
  workspaceId: string,
  syncBaseUrl: string,
  user: LocalUser,
): CollaborativeDoc {
  const doc = useMemo(() => new Y.Doc(), [workspaceId]);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    const ws = new WebsocketProvider(syncBaseUrl, workspaceId, doc);
    ws.awareness.setLocalStateField("user", user);
    const onStatus = (e: { status: ConnectionStatus }): void => setStatus(e.status);
    ws.on("status", onStatus);
    setProvider(ws);
    return () => {
      ws.off("status", onStatus);
      ws.destroy();
      doc.destroy();
    };
    // user is intentionally not a dependency: identity is fixed per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, syncBaseUrl, doc]);

  return { doc, provider, status };
}
