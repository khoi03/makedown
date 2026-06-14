/**
 * The tenancy service: composes auth (auth.ts), RBAC (rbac.ts), and a
 * {@link TenancyStore} into the operations the HTTP layer needs. This is the
 * `enabled` implementation of {@link TenancyProvider} — real users, orgs, roles,
 * and a provenance index.
 */
import { hashPassword, verifyPassword, generateSessionToken, hashToken } from "./auth.js";
import { can, type Role } from "./rbac.js";
import type { TenancyStore } from "./store.js";
import type { Org, ProvenanceRow } from "./types.js";
import type { Action } from "./rbac.js";
import type {
  TenancyProvider,
  Principal,
  AuthResult,
  ProvenanceInput,
} from "./provider.js";
import type { AnalyticsRange, AnalyticsSummary } from "./analytics.js";

const MIN_PASSWORD_LENGTH = 8;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ORG_SLUG_RETRIES = 5;

/** A constant credential used to equalize login timing for unknown users. */
let dummyHashPromise: Promise<string> | undefined;
const dummyHash = (): Promise<string> =>
  (dummyHashPromise ??= hashPassword("makedown-nonexistent-credential-placeholder"));

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "org";

export interface CreateWorkspaceArgs {
  readonly id: string;
  readonly orgId: string;
  readonly slug: string;
  readonly userId: string;
}

export class TenancyService implements TenancyProvider {
  readonly enabled = true;

  constructor(private readonly store: TenancyStore) {}

  async signup(email: string, password: string): Promise<AuthResult> {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const passwordHash = await hashPassword(password);
    const user = await this.store.createUser({ email, passwordHash });
    const org = await this.createPersonalOrg(email);
    await this.store.addMember({ orgId: org.id, userId: user.id, role: "owner" });
    const session = await this.openSession(user.id);
    return { user: { id: user.id, email: user.email }, org, ...session };
  }

  async login(email: string, password: string): Promise<AuthResult | undefined> {
    const user = await this.store.findUserByEmail(email);
    // Always run the KDF (even when the user is unknown) to avoid leaking
    // account existence through response timing.
    const hash = user?.passwordHash ?? (await dummyHash());
    const ok = await verifyPassword(password, hash);
    if (!user || !ok) return undefined;
    const orgs = await this.store.listOrgsForUser(user.id);
    const org = orgs[0];
    if (!org) return undefined; // a user always has a personal org; defensive
    const session = await this.openSession(user.id);
    return { user: { id: user.id, email: user.email }, org, ...session };
  }

  async logout(token: string): Promise<void> {
    await this.store.deleteSession(hashToken(token));
  }

  async authenticate(token: string | undefined): Promise<Principal | undefined> {
    if (!token) return undefined;
    const session = await this.store.findSession(hashToken(token));
    if (!session) return undefined;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await this.store.deleteSession(session.tokenHash);
      return undefined;
    }
    const user = await this.store.findUserById(session.userId);
    if (!user) return undefined;
    return { userId: user.id, email: user.email };
  }

  async authorize(userId: string, workspaceId: string, action: Action): Promise<boolean> {
    const role = await this.roleFor(userId, workspaceId);
    return role ? can(role, action) : false;
  }

  async authorizeOrg(userId: string, orgId: string, action: Action): Promise<boolean> {
    const membership = await this.store.findMembership(orgId, userId);
    return membership ? can(membership.role, action) : false;
  }

  async accessibleWorkspaceIds(userId: string): Promise<Set<string>> {
    const orgs = await this.store.listOrgsForUser(userId);
    const ids = new Set<string>();
    for (const org of orgs) {
      for (const ws of await this.store.listWorkspacesForOrg(org.id)) ids.add(ws.id);
    }
    return ids;
  }

  async listOrgs(userId: string): Promise<Org[]> {
    return this.store.listOrgsForUser(userId);
  }

  async unregisteredWorkspaceIds(candidateIds: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const id of candidateIds) {
      if (!(await this.store.findWorkspace(id))) out.push(id);
    }
    return out;
  }

  /** Create a workspace ownership record, authorizing the creator first. */
  async createWorkspace(args: CreateWorkspaceArgs) {
    const membership = await this.store.findMembership(args.orgId, args.userId);
    if (!membership || !can(membership.role, "workspace:create")) {
      throw new Error("Not authorized to create a workspace in this org");
    }
    return this.store.createWorkspace({
      id: args.id,
      orgId: args.orgId,
      slug: args.slug,
      createdBy: args.userId,
    });
  }

  /** Register an existing on-disk workspace under an org (TenancyProvider). */
  async registerWorkspace(userId: string, orgId: string, workspaceId: string): Promise<void> {
    await this.createWorkspace({ id: workspaceId, orgId, slug: workspaceId, userId });
  }

  /** Add an existing user (by email) to an org with a role. */
  async addMemberByEmail(orgId: string, email: string, role: Role): Promise<void> {
    const user = await this.store.findUserByEmail(email);
    if (!user) throw new Error(`No such user: ${email}`);
    await this.store.addMember({ orgId, userId: user.id, role });
  }

  async recordProvenance(workspaceId: string, rows: readonly ProvenanceInput[]): Promise<void> {
    const ws = await this.store.findWorkspace(workspaceId);
    if (!ws) return; // best-effort index: a workspace may not be registered yet
    for (const row of rows) {
      const full: ProvenanceRow = { ...row, workspaceId, orgId: ws.orgId };
      await this.store.upsertProvenance(full);
    }
  }

  /** Read the provenance index for a workspace (powers cost/usage views). */
  async listProvenance(workspaceId: string): Promise<ProvenanceRow[]> {
    return this.store.listProvenanceForWorkspace(workspaceId);
  }

  async analytics(orgId: string, range?: AnalyticsRange): Promise<AnalyticsSummary> {
    const breakdowns = await this.store.aggregateProvenanceForOrg(orgId, range);
    return {
      orgId,
      range: { from: range?.from ?? null, to: range?.to ?? null },
      ...breakdowns,
    };
  }

  private async roleFor(userId: string, workspaceId: string): Promise<Role | undefined> {
    const ws = await this.store.findWorkspace(workspaceId);
    if (!ws) return undefined;
    const membership = await this.store.findMembership(ws.orgId, userId);
    return membership?.role;
  }

  private async createPersonalOrg(email: string): Promise<Org> {
    const base = slugify(email.split("@")[0] ?? "org");
    const name = `${email.split("@")[0] ?? "Personal"}'s workspace`;
    for (let attempt = 0; attempt < ORG_SLUG_RETRIES; attempt++) {
      const suffix = generateSessionToken().slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, "");
      try {
        return await this.store.createOrg({ name, slug: `${base}-${suffix}` });
      } catch {
        // slug collision — retry with a fresh suffix
      }
    }
    throw new Error("Could not allocate a unique org slug");
  }

  private async openSession(userId: string): Promise<{ token: string; expiresAt: string }> {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await this.store.createSession({ tokenHash: hashToken(token), userId, expiresAt });
    return { token, expiresAt };
  }
}
