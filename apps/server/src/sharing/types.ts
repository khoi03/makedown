/**
 * Sharing domain entities. A {@link Share} is a public, read-only capability
 * pointing at one built artifact (workspace + target). Unlike sessions, a share
 * has a stable id (used to list/revoke it) *and* a token hash (the bearer secret
 * in the `/s/:token` URL); the raw token is shown once at creation and never
 * persisted. Shared by every {@link import("./store.js").ShareStore}.
 */

export interface Share {
  /** Stable public id — addresses the share for listing and revocation. */
  readonly id: string;
  /** SHA-256 of the bearer token. The raw token is never persisted. */
  readonly tokenHash: string;
  readonly workspaceId: string;
  readonly target: string;
  /** Whether the public view includes provenance (model, inputs, cost). */
  readonly includeProvenance: boolean;
  readonly createdAt: string;
  /** ISO timestamp, or null for a link that never expires. */
  readonly expiresAt: string | null;
  /** ISO timestamp once revoked, else null. */
  readonly revokedAt: string | null;
}

/** A share as shown to its author — never includes token material. */
export interface ShareSummary {
  readonly id: string;
  readonly target: string;
  readonly includeProvenance: boolean;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revoked: boolean;
}
