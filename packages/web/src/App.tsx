/**
 * Root: hash-routed workspace selection (`#/<workspaceId>` for shareable URLs).
 * With no workspace in the hash, shows a picker over the server's workspaces.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ApiClient } from "./lib/api.js";
import { makeLocalUser } from "./hooks/useCollaborativeDoc.js";
import { WorkspacePicker } from "./components/WorkspacePicker.js";

// The workbench pulls in the heavy editor/graph/CRDT stack — load it only when
// a workspace is actually opened, keeping the landing route lightweight.
const Workbench = lazy(() =>
  import("./components/Workbench.js").then((m) => ({ default: m.Workbench })),
);

function workspaceFromHash(): string | undefined {
  const m = /^#\/([^/?#]+)/.exec(window.location.hash);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

export function App() {
  const api = useMemo(() => new ApiClient(), []);
  const user = useMemo(() => makeLocalUser(), []);
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(workspaceFromHash);

  useEffect(() => {
    const onHash = (): void => setWorkspaceId(workspaceFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (!workspaceId) {
    return <WorkspacePicker api={api} onPick={(id) => (window.location.hash = `#/${encodeURIComponent(id)}`)} />;
  }

  return (
    <Suspense fallback={<div className="app-loading">Opening workspace…</div>}>
      <Workbench key={workspaceId} api={api} workspaceId={workspaceId} user={user} />
    </Suspense>
  );
}
