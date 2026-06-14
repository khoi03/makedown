/**
 * Root: hash-routed workspace selection (`#/<workspaceId>` for shareable URLs).
 * With no workspace in the hash, shows a picker over the server's workspaces.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ApiClient } from "./lib/api.js";
import { makeLocalUser } from "./hooks/useCollaborativeDoc.js";
import { WorkspacePicker } from "./components/WorkspacePicker.js";
import { AuthGate } from "./components/auth/AuthGate.js";

// The workbench pulls in the heavy editor/graph/CRDT stack — load it only when
// a workspace is actually opened, keeping the landing route lightweight.
const Workbench = lazy(() =>
  import("./components/Workbench.js").then((m) => ({ default: m.Workbench })),
);

// The analytics dashboard is its own route; lazy-load it too so it never weighs
// down the landing bundle.
const Dashboard = lazy(() =>
  import("./components/dashboard/Dashboard.js").then((m) => ({ default: m.Dashboard })),
);

type Route =
  | { readonly kind: "picker" }
  | { readonly kind: "analytics" }
  | { readonly kind: "workspace"; readonly id: string };

function routeFromHash(): Route {
  const hash = window.location.hash;
  if (/^#\/analytics\b/.test(hash)) return { kind: "analytics" };
  const m = /^#\/([^/?#]+)/.exec(hash);
  return m?.[1] ? { kind: "workspace", id: decodeURIComponent(m[1]) } : { kind: "picker" };
}

export function App() {
  const api = useMemo(() => new ApiClient(), []);
  const user = useMemo(() => makeLocalUser(), []);
  const [route, setRoute] = useState<Route>(routeFromHash);

  useEffect(() => {
    const onHash = (): void => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goPicker = (): void => {
    window.location.hash = "";
  };

  const body =
    route.kind === "analytics" ? (
      <Suspense fallback={<div className="app-loading">Loading analytics…</div>}>
        <Dashboard api={api} onBack={goPicker} />
      </Suspense>
    ) : route.kind === "workspace" ? (
      <Suspense fallback={<div className="app-loading">Opening workspace…</div>}>
        <Workbench key={route.id} api={api} workspaceId={route.id} user={user} />
      </Suspense>
    ) : (
      <WorkspacePicker
        api={api}
        onPick={(id) => (window.location.hash = `#/${encodeURIComponent(id)}`)}
        onOpenAnalytics={() => (window.location.hash = "#/analytics")}
      />
    );

  // The gate is a no-op (renders `body` directly) when the server is
  // single-tenant; it only interposes a sign-in screen when auth is enabled.
  return (
    <AuthGate api={api}>{body}</AuthGate>
  );
}
