/**
 * The tenancy seam the HTTP layer depends on. Two implementations:
 *  - {@link import("./null-tenancy.js").NullTenancy} — auth disabled (no
 *    DATABASE_URL): a permissive single-tenant passthrough that preserves the
 *    original server behavior so the no-DB test suite stays green.
 *  - {@link import("./service.js").TenancyService} — auth enabled: real users,
 *    orgs, RBAC, and a provenance index, backed by a {@link TenancyStore}.
 *
 * The HTTP layer calls the same methods regardless; `enabled` lets it skip the
 * login wall and per-request authorization entirely when tenancy is off.
 */
import type { Action } from "./rbac.js";
import type { Org, ProvenanceRow } from "./types.js";
import type { AnalyticsRange, AnalyticsSummary } from "./analytics.js";

/** The authenticated caller resolved from a session token. */
export interface Principal {
  readonly userId: string;
  readonly email: string;
}

/** The result of a successful signup/login. */
export interface AuthResult {
  readonly user: { readonly id: string; readonly email: string };
  readonly org: Org;
  /** The raw session token (set as an httpOnly cookie by the route). */
  readonly token: string;
  readonly expiresAt: string;
}

/** A provenance record to index, minus the org (the provider resolves it). */
export type ProvenanceInput = Omit<ProvenanceRow, "orgId">;

export interface TenancyProvider {
  /** Whether auth/RBAC is active. When false the server runs single-tenant. */
  readonly enabled: boolean;

  /** Resolve a session token to a principal, or undefined if missing/invalid/expired. */
  authenticate(token: string | undefined): Promise<Principal | undefined>;

  /** Whether `userId` may perform `action` on `workspaceId`. */
  authorize(userId: string, workspaceId: string, action: Action): Promise<boolean>;

  /**
   * Whether `userId` may perform `action` directly on org `orgId` (org-scoped,
   * not via a workspace). Powers the cross-workspace analytics surface. Always
   * true when tenancy is disabled.
   */
  authorizeOrg(userId: string, orgId: string, action: Action): Promise<boolean>;

  /**
   * The set of workspace ids `userId` can see, or `undefined` for "unrestricted"
   * (null tenancy). The server intersects this with the on-disk workspace list.
   */
  accessibleWorkspaceIds(userId: string): Promise<Set<string> | undefined>;

  /** Create a user + personal org + session. Throws if auth is disabled or email taken. */
  signup(email: string, password: string): Promise<AuthResult>;

  /** Verify credentials and open a session, or undefined on bad credentials. */
  login(email: string, password: string): Promise<AuthResult | undefined>;

  /** Invalidate a session token (idempotent). */
  logout(token: string): Promise<void>;

  /** Orgs the user belongs to. */
  listOrgs(userId: string): Promise<Org[]>;

  /**
   * Of the given on-disk workspace ids, the subset not yet registered to any org
   * (i.e. claimable). Empty when tenancy is disabled. Powers the "add a
   * workspace" affordance for a freshly-signed-up user.
   */
  unregisteredWorkspaceIds(candidateIds: readonly string[]): Promise<string[]>;

  /**
   * Register an (existing on-disk) workspace under an org, making it accessible
   * to that org's members. Authorizes the caller (must be able to create
   * workspaces in the org) before recording ownership. Throws when auth is off.
   */
  registerWorkspace(userId: string, orgId: string, workspaceId: string): Promise<void>;

  /** Index provenance rows for a workspace (no-op when tenancy is disabled). */
  recordProvenance(workspaceId: string, rows: readonly ProvenanceInput[]): Promise<void>;

  /**
   * Cost/usage analytics over an org's provenance index within an optional time
   * window. Returns `undefined` when tenancy is disabled (no index → the
   * dashboard renders a graceful single-tenant empty state).
   */
  analytics(orgId: string, range?: AnalyticsRange): Promise<AnalyticsSummary | undefined>;
}
