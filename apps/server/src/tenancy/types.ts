/**
 * Tenancy domain entities. These are the persisted shapes shared by every
 * {@link import("./store.js").TenancyStore} implementation (in-memory and
 * Postgres/Drizzle). Provenance rows are a denormalized *index* over the
 * canonical CAS records — re-derivable, never the source of truth.
 */
import type { Role } from "./rbac.js";
import type { StepType } from "@makedown/shared";

export type { Role };

export interface User {
  readonly id: string;
  readonly email: string;
  /** scrypt-encoded password hash (see auth.ts). Never sent to clients. */
  readonly passwordHash: string;
  readonly createdAt: string;
}

export interface Org {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: string;
}

export interface Membership {
  readonly orgId: string;
  readonly userId: string;
  readonly role: Role;
  readonly createdAt: string;
}

export interface Workspace {
  /** The path-safe workspace id (also its on-disk directory name). */
  readonly id: string;
  readonly orgId: string;
  readonly slug: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface Session {
  /** SHA-256 of the session token. The raw token is never persisted. */
  readonly tokenHash: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * A denormalized provenance row — one per (workspace, identity-hash). Powers
 * cross-workspace cost/usage queries without touching the per-workspace CAS.
 */
export interface ProvenanceRow {
  /** Identity hash (the CAS key). Unique within a workspace. */
  readonly id: string;
  readonly workspaceId: string;
  readonly orgId: string;
  readonly target: string;
  readonly step: StepType;
  readonly model: string | null;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly costUsd: number;
  readonly producedAt: string;
}
