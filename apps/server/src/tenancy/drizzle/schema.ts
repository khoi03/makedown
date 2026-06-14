/**
 * Drizzle schema for the tenancy + provenance-index tables (Postgres dialect).
 *
 * Timestamps are stored as ISO-8601 text to match the in-memory store and keep
 * behavior identical across drivers (no implicit timezone coercion). The paired
 * {@link SCHEMA_SQL} DDL is the single migration applied at startup and in tests
 * (pglite) — co-located here so the table objects and DDL can't drift apart.
 */
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  primaryKey,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.userId] }) }),
);

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  slug: text("slug").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const provenance = pgTable(
  "provenance",
  {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    orgId: text("org_id").notNull(),
    target: text("target").notNull(),
    step: text("step").notNull(),
    model: text("model"),
    tokensInput: integer("tokens_input").notNull(),
    tokensOutput: integer("tokens_output").notNull(),
    costUsd: doublePrecision("cost_usd").notNull(),
    producedAt: text("produced_at").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.id] }) }),
);

export const schema = { users, orgs, memberships, workspaces, sessions, provenance };

/** The full DDL, applied once at startup and in tests. Idempotent. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  org_id text NOT NULL,
  user_id text NOT NULL,
  role text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  slug text NOT NULL,
  created_by text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS workspaces_org_id_idx ON workspaces (org_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  created_at text NOT NULL,
  expires_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS provenance (
  id text NOT NULL,
  workspace_id text NOT NULL,
  org_id text NOT NULL,
  target text NOT NULL,
  step text NOT NULL,
  model text,
  tokens_input integer NOT NULL,
  tokens_output integer NOT NULL,
  cost_usd double precision NOT NULL,
  produced_at text NOT NULL,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS provenance_org_id_idx ON provenance (org_id);
-- Composite index for the analytics dashboard's org-scoped, time-windowed scans.
CREATE INDEX IF NOT EXISTS provenance_org_produced_idx ON provenance (org_id, produced_at);
`;
