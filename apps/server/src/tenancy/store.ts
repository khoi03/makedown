/**
 * The tenancy persistence seam (Repository pattern). The service layer depends
 * only on this interface, so the same logic runs against the in-memory store
 * (tests, small self-host) and the Postgres/Drizzle adapter (production) without
 * change. All methods are async to accommodate a real database.
 */
import type { Role } from "./rbac.js";
import type {
  User,
  Org,
  Membership,
  Workspace,
  Session,
  ProvenanceRow,
} from "./types.js";
import type { AnalyticsRange, AnalyticsBreakdowns } from "./analytics.js";

/** Thrown when a uniqueness constraint (email, org slug, workspace id) is violated. */
export class DuplicateError extends Error {
  constructor(what: string) {
    super(`Already exists: ${what}`);
    this.name = "DuplicateError";
  }
}

export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
}

export interface CreateOrgInput {
  readonly name: string;
  readonly slug: string;
}

export interface AddMemberInput {
  readonly orgId: string;
  readonly userId: string;
  readonly role: Role;
}

export interface CreateWorkspaceInput {
  readonly id: string;
  readonly orgId: string;
  readonly slug: string;
  readonly createdBy: string;
}

export interface CreateSessionInput {
  readonly tokenHash: string;
  readonly userId: string;
  readonly expiresAt: string;
}

export interface TenancyStore {
  // Users
  createUser(input: CreateUserInput): Promise<User>;
  findUserByEmail(email: string): Promise<User | undefined>;
  findUserById(id: string): Promise<User | undefined>;

  // Orgs + memberships
  createOrg(input: CreateOrgInput): Promise<Org>;
  addMember(input: AddMemberInput): Promise<Membership>;
  findMembership(orgId: string, userId: string): Promise<Membership | undefined>;
  listMembers(orgId: string): Promise<Membership[]>;
  listOrgsForUser(userId: string): Promise<Org[]>;
  updateMemberRole(orgId: string, userId: string, role: Role): Promise<void>;
  removeMember(orgId: string, userId: string): Promise<void>;

  // Workspaces
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  findWorkspace(id: string): Promise<Workspace | undefined>;
  listWorkspacesForOrg(orgId: string): Promise<Workspace[]>;

  // Sessions
  createSession(input: CreateSessionInput): Promise<Session>;
  findSession(tokenHash: string): Promise<Session | undefined>;
  deleteSession(tokenHash: string): Promise<void>;

  // Provenance index (denormalized projection over the CAS)
  upsertProvenance(row: ProvenanceRow): Promise<void>;
  listProvenanceForWorkspace(workspaceId: string): Promise<ProvenanceRow[]>;
  deleteProvenanceForWorkspace(workspaceId: string): Promise<void>;

  /**
   * Aggregate the org's provenance index into cost/usage breakdowns within an
   * optional time window. Aggregation happens in the data layer (SQL `GROUP BY`
   * / in-memory reduction) so the full row set is never materialized.
   */
  aggregateProvenanceForOrg(
    orgId: string,
    range?: AnalyticsRange,
  ): Promise<AnalyticsBreakdowns>;
}
