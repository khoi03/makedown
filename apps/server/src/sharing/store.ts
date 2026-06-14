/**
 * The sharing persistence seam (Repository pattern), mirroring the tenancy
 * store. The {@link SharingService} depends only on this interface, so the same
 * logic runs against the in-memory store (tests, small self-host), the
 * file-backed store (no-DB self-host), and the Drizzle/Postgres adapter without
 * change. All methods are async to accommodate a real database.
 */
import type { Share } from "./types.js";

export interface CreateShareInput {
  readonly id: string;
  readonly tokenHash: string;
  readonly workspaceId: string;
  readonly target: string;
  readonly includeProvenance: boolean;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export interface ShareStore {
  create(input: CreateShareInput): Promise<Share>;
  /** Look a share up by the hash of its bearer token (the `/s/:token` path). */
  findByTokenHash(tokenHash: string): Promise<Share | undefined>;
  findById(id: string): Promise<Share | undefined>;
  listForWorkspace(workspaceId: string): Promise<Share[]>;
  /** Mark a share revoked at the given timestamp (idempotent). */
  revoke(id: string, revokedAt: string): Promise<void>;
}
