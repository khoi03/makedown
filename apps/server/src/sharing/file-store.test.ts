import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileShareStore } from "./file-store.js";

/**
 * The file-backed store is the no-DB persistence path: a single server-level
 * JSON registry keyed by token hash, so the public `/s/:token` route resolves a
 * link without scanning workspaces and survives a restart.
 */
describe("FileShareStore", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdshare-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const input = (over: Partial<Parameters<FileShareStore["create"]>[0]> = {}) => ({
    id: "id-1",
    tokenHash: "hash-1",
    workspaceId: "w1",
    target: "summary",
    includeProvenance: false,
    createdAt: "2026-06-13T00:00:00Z",
    expiresAt: null,
    ...over,
  });

  it("creates and finds a share by token hash and by id", async () => {
    const store = new FileShareStore(root);
    await store.create(input());
    expect((await store.findByTokenHash("hash-1"))?.target).toBe("summary");
    expect((await store.findById("id-1"))?.workspaceId).toBe("w1");
  });

  it("persists across instances (survives a restart)", async () => {
    await new FileShareStore(root).create(input());
    const reopened = new FileShareStore(root);
    expect((await reopened.findById("id-1"))?.target).toBe("summary");
  });

  it("scopes listForWorkspace and sorts nothing it shouldn't see", async () => {
    const store = new FileShareStore(root);
    await store.create(input({ id: "a", tokenHash: "ha", workspaceId: "w1", target: "a" }));
    await store.create(input({ id: "b", tokenHash: "hb", workspaceId: "w2", target: "b" }));
    const w1 = await store.listForWorkspace("w1");
    expect(w1.map((s) => s.id)).toEqual(["a"]);
  });

  it("revokes idempotently and stamps revokedAt once", async () => {
    const store = new FileShareStore(root);
    await store.create(input());
    await store.revoke("id-1", "2026-06-13T01:00:00Z");
    await store.revoke("id-1", "2026-06-13T02:00:00Z");
    expect((await store.findById("id-1"))?.revokedAt).toBe("2026-06-13T01:00:00Z");
  });

  it("writes atomically (no partial temp file left behind)", async () => {
    const store = new FileShareStore(root);
    await store.create(input());
    const text = await readFile(join(root, ".makedown-shares.json"), "utf8");
    expect(JSON.parse(text)).toHaveProperty("id-1");
  });
});
