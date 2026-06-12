/**
 * Shares the signed-in account (+ sign-out) with whatever chrome wants to render
 * it — the workbench toolbar and the workspace picker — so the account control
 * lives *in* the layout instead of floating over it. Null when tenancy is off.
 */
import { createContext, useContext } from "react";
import type { AuthUser } from "../../lib/api.js";

export interface Account {
  readonly user: AuthUser;
  readonly signOut: () => void | Promise<void>;
}

export const SessionContext = createContext<Account | null>(null);

/** The current account, or null when auth is disabled / not signed in. */
export function useAccount(): Account | null {
  return useContext(SessionContext);
}
