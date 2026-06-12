/**
 * Resolves the server's auth posture once on mount: whether tenancy is enabled
 * and, if so, who (if anyone) is signed in. A single-tenant server (or an older
 * server with no `/api/tenancy`) resolves to `disabled`, so the UI shows no login
 * wall and behaves exactly as before.
 */
import { useCallback, useEffect, useState } from "react";
import type { ApiClient, AuthUser } from "../lib/api.js";

export type SessionState =
  | { readonly status: "loading" }
  | { readonly status: "disabled" }
  | { readonly status: "anon" }
  | { readonly status: "authed"; readonly user: AuthUser };

export interface Session {
  readonly state: SessionState;
  /** Re-probe the session (call after a successful login/signup). */
  readonly refresh: () => Promise<void>;
  /** End the session and return to the sign-in screen. */
  readonly signOut: () => Promise<void>;
}

export function useSession(api: ApiClient): Session {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { enabled } = await api.getTenancy();
      if (!enabled) {
        setState({ status: "disabled" });
        return;
      }
      const user = await api.getSession();
      setState(user ? { status: "authed", user } : { status: "anon" });
    } catch {
      // Server unreachable or no /api/tenancy (older single-tenant build):
      // fail open to the original no-auth experience.
      setState({ status: "disabled" });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await api.logout();
    } finally {
      setState({ status: "anon" });
    }
  }, [api]);

  return { state, refresh, signOut };
}
