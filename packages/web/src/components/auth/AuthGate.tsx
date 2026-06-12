/**
 * Wraps the app and gates it on the server's auth posture:
 *  - tenancy disabled  → render children unchanged (single-tenant, no login)
 *  - enabled + no user → render the {@link AuthScreen}
 *  - enabled + signed-in → render children + a small account menu
 */
import { useMemo, type ReactNode } from "react";
import type { ApiClient } from "../../lib/api.js";
import { useSession } from "../../hooks/useSession.js";
import { AuthScreen } from "./AuthScreen.js";
import { SessionContext, type Account } from "./session-context.js";

interface AuthGateProps {
  readonly api: ApiClient;
  readonly children: ReactNode;
}

export function AuthGate({ api, children }: AuthGateProps) {
  const { state, refresh, signOut } = useSession(api);

  // Publish the account (or null) so chrome — the toolbar, the picker — can
  // render the account control in-flow rather than floating it over the layout.
  const account = useMemo<Account | null>(
    () => (state.status === "authed" ? { user: state.user, signOut } : null),
    [state, signOut],
  );

  if (state.status === "loading") {
    return <div className="app-loading">Connecting…</div>;
  }
  if (state.status === "anon") {
    return <AuthScreen api={api} onAuthed={() => void refresh()} />;
  }

  return <SessionContext.Provider value={account}>{children}</SessionContext.Provider>;
}
