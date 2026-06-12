import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryTenancyStore } from "./memory-store.js";
import { DuplicateError, type TenancyStore } from "./store.js";

/**
 * The store is the persistence seam: the in-memory implementation is used in
 * tests (and small self-host deployments) and the Postgres/Drizzle adapter is
 * verified against the very same contract. These tests document that contract —
 * uniqueness, immutability of returned records, and idempotent provenance upsert.
 */
describe("InMemoryTenancyStore", () => {
  let store: TenancyStore;
  beforeEach(() => {
    store = new InMemoryTenancyStore();
  });

  describe("users", () => {
    it("creates and finds a user by email and id", async () => {
      const user = await store.createUser({ email: "a@example.com", passwordHash: "h" });
      expect(user.id).toBeTruthy();
      expect(await store.findUserByEmail("a@example.com")).toEqual(user);
      expect(await store.findUserById(user.id)).toEqual(user);
    });

    it("treats email as case-insensitively unique", async () => {
      await store.createUser({ email: "Dup@Example.com", passwordHash: "h" });
      await expect(
        store.createUser({ email: "dup@example.com", passwordHash: "h2" }),
      ).rejects.toBeInstanceOf(DuplicateError);
    });

    it("returns undefined for an unknown user", async () => {
      expect(await store.findUserByEmail("nope@example.com")).toBeUndefined();
      expect(await store.findUserById("nope")).toBeUndefined();
    });
  });

  describe("orgs and memberships", () => {
    it("creates an org with a unique slug and records members", async () => {
      const user = await store.createUser({ email: "o@example.com", passwordHash: "h" });
      const org = await store.createOrg({ name: "Acme", slug: "acme" });
      await store.addMember({ orgId: org.id, userId: user.id, role: "owner" });

      expect(await store.findMembership(org.id, user.id)).toMatchObject({ role: "owner" });
      expect(await store.listOrgsForUser(user.id)).toEqual([org]);
      const members = await store.listMembers(org.id);
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ userId: user.id, role: "owner" });
    });

    it("rejects a duplicate org slug", async () => {
      await store.createOrg({ name: "One", slug: "taken" });
      await expect(store.createOrg({ name: "Two", slug: "taken" })).rejects.toBeInstanceOf(
        DuplicateError,
      );
    });

    it("updates and removes a member", async () => {
      const user = await store.createUser({ email: "m@example.com", passwordHash: "h" });
      const org = await store.createOrg({ name: "Acme", slug: "acme2" });
      await store.addMember({ orgId: org.id, userId: user.id, role: "member" });

      await store.updateMemberRole(org.id, user.id, "admin");
      expect(await store.findMembership(org.id, user.id)).toMatchObject({ role: "admin" });

      await store.removeMember(org.id, user.id);
      expect(await store.findMembership(org.id, user.id)).toBeUndefined();
    });
  });

  describe("workspaces", () => {
    it("creates a workspace owned by an org and lists by org", async () => {
      const org = await store.createOrg({ name: "Acme", slug: "acme3" });
      const ws = await store.createWorkspace({
        id: "alpha",
        orgId: org.id,
        slug: "alpha",
        createdBy: "u1",
      });
      expect(ws.id).toBe("alpha");
      expect(await store.findWorkspace("alpha")).toEqual(ws);
      expect(await store.listWorkspacesForOrg(org.id)).toEqual([ws]);
    });

    it("rejects a duplicate workspace id", async () => {
      const org = await store.createOrg({ name: "Acme", slug: "acme4" });
      await store.createWorkspace({ id: "dup", orgId: org.id, slug: "dup", createdBy: "u" });
      await expect(
        store.createWorkspace({ id: "dup", orgId: org.id, slug: "dup", createdBy: "u" }),
      ).rejects.toBeInstanceOf(DuplicateError);
    });
  });

  describe("sessions", () => {
    it("creates, finds, and deletes a session by token hash", async () => {
      const session = await store.createSession({
        tokenHash: "th",
        userId: "u1",
        expiresAt: new Date(Date.now() + 1000).toISOString(),
      });
      expect(await store.findSession("th")).toEqual(session);
      await store.deleteSession("th");
      expect(await store.findSession("th")).toBeUndefined();
    });
  });

  describe("provenance index", () => {
    const row = {
      id: "sha256:abc",
      workspaceId: "alpha",
      orgId: "org1",
      target: "summary",
      step: "chat" as const,
      model: "claude-opus-4-8",
      tokensInput: 100,
      tokensOutput: 50,
      costUsd: 0.01,
      producedAt: "2026-06-12T00:00:00Z",
    };

    it("upserts idempotently keyed by (workspaceId, id)", async () => {
      await store.upsertProvenance(row);
      await store.upsertProvenance({ ...row, costUsd: 0.02 }); // same key, new value
      const rows = await store.listProvenanceForWorkspace("alpha");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.costUsd).toBe(0.02);
    });

    it("scopes rows by workspace and supports reindex (delete-all then re-add)", async () => {
      await store.upsertProvenance(row);
      await store.upsertProvenance({ ...row, id: "sha256:def", target: "draft" });
      await store.upsertProvenance({ ...row, workspaceId: "beta", id: "sha256:xyz" });

      expect(await store.listProvenanceForWorkspace("alpha")).toHaveLength(2);
      await store.deleteProvenanceForWorkspace("alpha");
      expect(await store.listProvenanceForWorkspace("alpha")).toHaveLength(0);
      // other workspaces untouched
      expect(await store.listProvenanceForWorkspace("beta")).toHaveLength(1);
    });
  });

  it("returns immutable copies — mutating a returned record does not corrupt the store", async () => {
    const user = await store.createUser({ email: "imm@example.com", passwordHash: "h" });
    (user as { email: string }).email = "hacked@example.com";
    expect(await store.findUserByEmail("imm@example.com")).toBeDefined();
    expect(await store.findUserByEmail("hacked@example.com")).toBeUndefined();
  });
});
