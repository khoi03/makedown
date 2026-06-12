/**
 * Postgres-backed {@link TenancyStore} via Drizzle. Driver-agnostic: it accepts
 * any Drizzle Postgres database (postgres-js in production, pglite in tests), so
 * the exact same queries that ship are the ones verified in CI. Uniqueness
 * violations surface as {@link DuplicateError}, matching the in-memory store.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Role } from "../rbac.js";
import type { User, Org, Membership, Workspace, Session, ProvenanceRow } from "../types.js";
import {
  DuplicateError,
  type TenancyStore,
  type CreateUserInput,
  type CreateOrgInput,
  type AddMemberInput,
  type CreateWorkspaceInput,
  type CreateSessionInput,
} from "../store.js";
import { users, orgs, memberships, workspaces, sessions, provenance } from "./schema.js";

/** Any Drizzle Postgres database, regardless of the underlying driver. */
export type TenancyDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

const randomId = (): string => crypto.randomUUID();
const nowIso = (): string => new Date().toISOString();
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Whether an error is a Postgres unique-violation (SQLSTATE 23505). Drizzle
 * wraps the driver error in a "Failed query" error, so the code/message can sit
 * on a nested `cause` — walk the chain. Works for both postgres-js and pglite.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === "23505") return true;
    if (typeof e.message === "string" && /duplicate key value|unique constraint/i.test(e.message)) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

async function guardUnique<T>(what: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateError(what);
    throw error;
  }
}

export class DrizzleTenancyStore implements TenancyStore {
  constructor(private readonly db: TenancyDatabase) {}

  async createUser(input: CreateUserInput): Promise<User> {
    const row: User = {
      id: randomId(),
      email: normalizeEmail(input.email),
      passwordHash: input.passwordHash,
      createdAt: nowIso(),
    };
    await guardUnique(`user ${row.email}`, () => this.db.insert(users).values(row));
    return row;
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const rows = await this.db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
    return rows[0];
  }

  async findUserById(id: string): Promise<User | undefined> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0];
  }

  async createOrg(input: CreateOrgInput): Promise<Org> {
    const row: Org = { id: randomId(), name: input.name, slug: input.slug, createdAt: nowIso() };
    await guardUnique(`org slug ${input.slug}`, () => this.db.insert(orgs).values(row));
    return row;
  }

  async addMember(input: AddMemberInput): Promise<Membership> {
    const row: Membership = { ...input, createdAt: nowIso() };
    await this.db
      .insert(memberships)
      .values(row)
      .onConflictDoUpdate({
        target: [memberships.orgId, memberships.userId],
        set: { role: input.role },
      });
    return row;
  }

  async findMembership(orgId: string, userId: string): Promise<Membership | undefined> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .limit(1);
    return rows[0] as Membership | undefined;
  }

  async listMembers(orgId: string): Promise<Membership[]> {
    return (await this.db.select().from(memberships).where(eq(memberships.orgId, orgId))) as Membership[];
  }

  async listOrgsForUser(userId: string): Promise<Org[]> {
    const mine = await this.db
      .select({ orgId: memberships.orgId })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    const orgIds = mine.map((m) => m.orgId);
    if (orgIds.length === 0) return [];
    return this.db.select().from(orgs).where(inArray(orgs.id, orgIds));
  }

  async updateMemberRole(orgId: string, userId: string, role: Role): Promise<void> {
    await this.db
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.db
      .delete(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const row: Workspace = { ...input, createdAt: nowIso() };
    await guardUnique(`workspace ${input.id}`, () => this.db.insert(workspaces).values(row));
    return row;
  }

  async findWorkspace(id: string): Promise<Workspace | undefined> {
    const rows = await this.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return rows[0];
  }

  async listWorkspacesForOrg(orgId: string): Promise<Workspace[]> {
    return this.db.select().from(workspaces).where(eq(workspaces.orgId, orgId));
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const row: Session = { ...input, createdAt: nowIso() };
    await this.db.insert(sessions).values(row);
    return row;
  }

  async findSession(tokenHash: string): Promise<Session | undefined> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
    return rows[0];
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async upsertProvenance(row: ProvenanceRow): Promise<void> {
    await this.db
      .insert(provenance)
      .values(row)
      .onConflictDoUpdate({
        target: [provenance.workspaceId, provenance.id],
        set: {
          orgId: row.orgId,
          target: row.target,
          step: row.step,
          model: row.model,
          tokensInput: row.tokensInput,
          tokensOutput: row.tokensOutput,
          costUsd: row.costUsd,
          producedAt: row.producedAt,
        },
      });
  }

  async listProvenanceForWorkspace(workspaceId: string): Promise<ProvenanceRow[]> {
    return (await this.db
      .select()
      .from(provenance)
      .where(eq(provenance.workspaceId, workspaceId))) as ProvenanceRow[];
  }

  async deleteProvenanceForWorkspace(workspaceId: string): Promise<void> {
    await this.db.delete(provenance).where(eq(provenance.workspaceId, workspaceId));
  }
}
