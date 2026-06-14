/**
 * Drizzle schema for the shares table (Postgres dialect). Kept beside the
 * tenancy schema in shape and conventions: text columns, ISO-8601 timestamps as
 * text, an idempotent {@link SHARE_SCHEMA_SQL} DDL applied at startup and in
 * tests (pglite). Co-located so the table object and the DDL can't drift.
 */
import { pgTable, text, boolean, index } from "drizzle-orm/pg-core";

export const shares = pgTable(
  "shares",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    workspaceId: text("workspace_id").notNull(),
    target: text("target").notNull(),
    includeProvenance: boolean("include_provenance").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => ({ workspaceIdx: index("shares_workspace_id_idx").on(t.workspaceId) }),
);

export const shareSchema = { shares };

/** The shares DDL, applied once at startup and in tests. Idempotent. */
export const SHARE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  workspace_id text NOT NULL,
  target text NOT NULL,
  include_provenance boolean NOT NULL,
  created_at text NOT NULL,
  expires_at text,
  revoked_at text
);
CREATE INDEX IF NOT EXISTS shares_workspace_id_idx ON shares (workspace_id);
`;
