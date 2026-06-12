import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleTenancyStore } from "./store.js";
import { schema, SCHEMA_SQL } from "./schema.js";
import { DuplicateError, type TenancyStore } from "../store.js";

/**
 * The Postgres adapter is verified against pglite — a real Postgres engine
 * compiled to WASM, running in-process. This proves the SQL/DDL and the
 * uniqueness/upsert semantics match the in-memory store's contract, with no
 * Docker or external database in CI.
 */
describe("DrizzleTenancyStore (pglite)", () => {
  let client: PGlite;
  let store: TenancyStore;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await client.exec(SCHEMA_SQL);
    store = new DrizzleTenancyStore(db);
  });

  afterEach(async () => {
    await client.close();
  });

  it("creates and finds users; enforces case-insensitive email uniqueness", async () => {
    const user = await store.createUser({ email: "A@Example.com", passwordHash: "h" });
    expect(await store.findUserByEmail("a@example.com")).toEqual(user);
    expect(await store.findUserById(user.id)).toEqual(user);
    await expect(
      store.createUser({ email: "a@example.com", passwordHash: "h2" }),
    ).rejects.toBeInstanceOf(DuplicateError);
  });

  it("creates orgs (unique slug) with members and lists them", async () => {
    const user = await store.createUser({ email: "o@example.com", passwordHash: "h" });
    const org = await store.createOrg({ name: "Acme", slug: "acme" });
    await store.addMember({ orgId: org.id, userId: user.id, role: "owner" });

    expect(await store.findMembership(org.id, user.id)).toMatchObject({ role: "owner" });
    expect(await store.listOrgsForUser(user.id)).toEqual([org]);
    expect(await store.listMembers(org.id)).toHaveLength(1);
    await expect(store.createOrg({ name: "x", slug: "acme" })).rejects.toBeInstanceOf(DuplicateError);
  });

  it("updates and removes members", async () => {
    const user = await store.createUser({ email: "m@example.com", passwordHash: "h" });
    const org = await store.createOrg({ name: "Acme", slug: "acme2" });
    await store.addMember({ orgId: org.id, userId: user.id, role: "member" });
    await store.updateMemberRole(org.id, user.id, "admin");
    expect(await store.findMembership(org.id, user.id)).toMatchObject({ role: "admin" });
    await store.removeMember(org.id, user.id);
    expect(await store.findMembership(org.id, user.id)).toBeUndefined();
  });

  it("creates and lists workspaces by org; rejects duplicate ids", async () => {
    const org = await store.createOrg({ name: "Acme", slug: "acme3" });
    const ws = await store.createWorkspace({ id: "alpha", orgId: org.id, slug: "alpha", createdBy: "u" });
    expect(await store.findWorkspace("alpha")).toEqual(ws);
    expect(await store.listWorkspacesForOrg(org.id)).toEqual([ws]);
    await expect(
      store.createWorkspace({ id: "alpha", orgId: org.id, slug: "alpha", createdBy: "u" }),
    ).rejects.toBeInstanceOf(DuplicateError);
  });

  it("creates, finds, and deletes sessions", async () => {
    const session = await store.createSession({
      tokenHash: "th",
      userId: "u1",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(await store.findSession("th")).toEqual(session);
    await store.deleteSession("th");
    expect(await store.findSession("th")).toBeUndefined();
  });

  it("upserts provenance idempotently and supports per-workspace reindex", async () => {
    const base = {
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
    await store.upsertProvenance(base);
    await store.upsertProvenance({ ...base, costUsd: 0.02 }); // same PK
    const rows = await store.listProvenanceForWorkspace("alpha");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costUsd).toBe(0.02);

    await store.upsertProvenance({ ...base, id: "sha256:def" });
    await store.upsertProvenance({ ...base, workspaceId: "beta", id: "sha256:xyz" });
    expect(await store.listProvenanceForWorkspace("alpha")).toHaveLength(2);
    await store.deleteProvenanceForWorkspace("alpha");
    expect(await store.listProvenanceForWorkspace("alpha")).toHaveLength(0);
    expect(await store.listProvenanceForWorkspace("beta")).toHaveLength(1);
  });

  it("preserves a null model and numeric fidelity in provenance", async () => {
    await store.upsertProvenance({
      id: "sha256:n",
      workspaceId: "w",
      orgId: "o",
      target: "t",
      step: "transform",
      model: null,
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0,
      producedAt: "2026-06-12T00:00:00Z",
    });
    const [row] = await store.listProvenanceForWorkspace("w");
    expect(row!.model).toBeNull();
    expect(row!.costUsd).toBe(0);
  });
});
