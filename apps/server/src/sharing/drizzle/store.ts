/**
 * Postgres-backed {@link ShareStore} via Drizzle. Driver-agnostic (postgres-js
 * in production, pglite in tests), so the exact queries that ship are the ones
 * verified in CI. Mirrors the {@link import("../store.js").ShareStore} contract
 * of the in-memory and file stores.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Share } from "../types.js";
import type { ShareStore, CreateShareInput } from "../store.js";
import { shares } from "./schema.js";

/** Any Drizzle Postgres database, regardless of the underlying driver. */
export type ShareDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export class DrizzleShareStore implements ShareStore {
  constructor(private readonly db: ShareDatabase) {}

  async create(input: CreateShareInput): Promise<Share> {
    const row: Share = { ...input, revokedAt: null };
    await this.db.insert(shares).values(row);
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<Share | undefined> {
    const rows = await this.db.select().from(shares).where(eq(shares.tokenHash, tokenHash)).limit(1);
    return rows[0] as Share | undefined;
  }

  async findById(id: string): Promise<Share | undefined> {
    const rows = await this.db.select().from(shares).where(eq(shares.id, id)).limit(1);
    return rows[0] as Share | undefined;
  }

  async listForWorkspace(workspaceId: string): Promise<Share[]> {
    return (await this.db
      .select()
      .from(shares)
      .where(eq(shares.workspaceId, workspaceId))) as Share[];
  }

  async revoke(id: string, revokedAt: string): Promise<void> {
    // Only stamp the first revocation (idempotent): guard on a null revoked_at.
    await this.db
      .update(shares)
      .set({ revokedAt })
      .where(and(eq(shares.id, id), isNull(shares.revokedAt)));
  }
}
