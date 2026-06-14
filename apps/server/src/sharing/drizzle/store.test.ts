import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleShareStore } from "./store.js";
import { shareSchema, SHARE_SCHEMA_SQL } from "./schema.js";
import type { ShareStore, CreateShareInput } from "../store.js";

/**
 * The Postgres share adapter is verified against pglite (real Postgres in WASM,
 * in-process) so the shipped SQL/DDL is exactly what CI exercises — no Docker.
 */
describe("DrizzleShareStore (pglite)", () => {
  let client: PGlite;
  let store: ShareStore;

  const input = (over: Partial<CreateShareInput> = {}): CreateShareInput => ({
    id: "id-1",
    tokenHash: "hash-1",
    workspaceId: "w1",
    target: "summary",
    includeProvenance: false,
    createdAt: "2026-06-13T00:00:00Z",
    expiresAt: null,
    ...over,
  });

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema: shareSchema });
    await client.exec(SHARE_SCHEMA_SQL);
    store = new DrizzleShareStore(db);
  });
  afterEach(async () => {
    await client.close();
  });

  it("creates and finds by token hash and id, preserving the provenance flag and expiry", async () => {
    await store.create(input({ includeProvenance: true, expiresAt: "2026-07-01T00:00:00Z" }));
    const byHash = await store.findByTokenHash("hash-1");
    expect(byHash).toMatchObject({
      workspaceId: "w1",
      target: "summary",
      includeProvenance: true,
      expiresAt: "2026-07-01T00:00:00Z",
      revokedAt: null,
    });
    expect((await store.findById("id-1"))?.id).toBe("id-1");
  });

  it("scopes listForWorkspace", async () => {
    await store.create(input({ id: "a", tokenHash: "ha", workspaceId: "w1" }));
    await store.create(input({ id: "b", tokenHash: "hb", workspaceId: "w2" }));
    const w1 = await store.listForWorkspace("w1");
    expect(w1.map((s) => s.id)).toEqual(["a"]);
  });

  it("revokes idempotently, stamping revokedAt only once", async () => {
    await store.create(input());
    await store.revoke("id-1", "2026-06-13T01:00:00Z");
    await store.revoke("id-1", "2026-06-13T09:00:00Z");
    expect((await store.findById("id-1"))?.revokedAt).toBe("2026-06-13T01:00:00Z");
  });

  it("returns undefined for an unknown token", async () => {
    expect(await store.findByTokenHash("nope")).toBeUndefined();
  });
});
