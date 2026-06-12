/**
 * Tenancy assembly + public surface. {@link createTenancy} selects the provider
 * from the environment: an explicit store (tests) or DATABASE_URL enables the
 * full {@link TenancyService}; otherwise the permissive {@link NullTenancy}.
 */
import { TenancyService } from "./service.js";
import { NullTenancy } from "./null-tenancy.js";
import type { TenancyStore } from "./store.js";
import type { TenancyProvider } from "./provider.js";

export { TenancyService } from "./service.js";
export { NullTenancy } from "./null-tenancy.js";
export { InMemoryTenancyStore } from "./memory-store.js";
export { createPostgresTenancy, type PostgresTenancy } from "./drizzle/postgres.js";
export { can, ROLES, type Role, type Action } from "./rbac.js";
export { DuplicateError, type TenancyStore } from "./store.js";
export type { TenancyProvider, Principal, AuthResult, ProvenanceInput } from "./provider.js";
export type { User, Org, Membership, Workspace, Session, ProvenanceRow } from "./types.js";

export interface CreateTenancyOptions {
  /** Environment to read configuration from. Defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
  /**
   * An explicit store (e.g. the in-memory store in tests). When provided, the
   * service is enabled regardless of DATABASE_URL.
   */
  readonly store?: TenancyStore;
}

/**
 * Build the tenancy provider. Synchronous so the server can construct it during
 * assembly; when a database is involved the caller awaits a separate migrate()
 * step before listening (see the Postgres adapter).
 */
export function createTenancy(opts: CreateTenancyOptions = {}): TenancyProvider {
  if (opts.store) return new TenancyService(opts.store);
  const env = opts.env ?? process.env;
  if (env["DATABASE_URL"]) {
    // The Postgres-backed store is wired in via createPostgresTenancy (async,
    // runs migrations) at server startup; reaching here without a store means
    // the caller should have used that path.
    throw new Error(
      "DATABASE_URL is set — construct the Postgres tenancy via createPostgresTenancy() so migrations run first.",
    );
  }
  return new NullTenancy();
}
