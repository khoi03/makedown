/**
 * The disabled (single-tenant) tenancy provider, used when no DATABASE_URL is
 * configured. It is deliberately permissive: there is no login wall and every
 * action is allowed, exactly reproducing the original pre-2.4 server behavior so
 * the no-DB test suite and solo/self-host experience are unchanged.
 */
import type { Org } from "./types.js";
import type { TenancyProvider, Principal, AuthResult } from "./provider.js";

export class NullTenancy implements TenancyProvider {
  readonly enabled = false;

  /** No sessions exist when auth is off; the server does not gate on a principal. */
  async authenticate(): Promise<Principal | undefined> {
    return undefined;
  }

  /** Everything is allowed in single-tenant mode. */
  async authorize(): Promise<boolean> {
    return true;
  }

  /** `undefined` = unrestricted: the server lists all on-disk workspaces. */
  async accessibleWorkspaceIds(): Promise<undefined> {
    return undefined;
  }

  async signup(): Promise<AuthResult> {
    throw new Error("Authentication is disabled (no DATABASE_URL configured)");
  }

  async login(): Promise<undefined> {
    return undefined;
  }

  async logout(): Promise<void> {
    /* no-op */
  }

  async listOrgs(): Promise<Org[]> {
    return [];
  }

  async registerWorkspace(): Promise<void> {
    throw new Error("Authentication is disabled (no DATABASE_URL configured)");
  }

  /** Nothing to claim in single-tenant mode — everything is already listed. */
  async unregisteredWorkspaceIds(): Promise<string[]> {
    return [];
  }

  async recordProvenance(): Promise<void> {
    /* no-op: there is no index without a database */
  }
}
