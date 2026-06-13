import { describe, it, expect } from "vitest";
import { SharingService } from "./service.js";
import { InMemoryShareStore } from "./memory-store.js";
import { hashToken } from "../tenancy/auth.js";

/**
 * A share is an unguessable, revocable, optionally-expiring bearer capability
 * pointing at one (workspace, target). The raw token is returned once at
 * creation; only its hash is ever stored, so a store leak isn't a usable link.
 */
describe("SharingService", () => {
  function make(now = () => Date.now()) {
    const store = new InMemoryShareStore();
    return { store, sharing: new SharingService(store, now) };
  }

  it("issues a high-entropy token and stores only its hash", async () => {
    const { store, sharing } = make();
    const { token, id } = await sharing.createShare({
      workspaceId: "w1",
      target: "summary",
      includeProvenance: false,
    });
    expect(token.length).toBeGreaterThanOrEqual(32);
    const stored = await store.findById(id);
    expect(stored?.tokenHash).toBe(hashToken(token));
    // The raw token must never be persisted.
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("resolves a live token back to its (workspace, target)", async () => {
    const { sharing } = make();
    const { token } = await sharing.createShare({
      workspaceId: "w1",
      target: "report",
      includeProvenance: true,
    });
    const share = await sharing.resolveShare(token);
    expect(share?.workspaceId).toBe("w1");
    expect(share?.target).toBe("report");
    expect(share?.includeProvenance).toBe(true);
  });

  it("returns undefined for an unknown token", async () => {
    const { sharing } = make();
    expect(await sharing.resolveShare("not-a-real-token")).toBeUndefined();
  });

  it("stops resolving once revoked", async () => {
    const { sharing } = make();
    const { token, id } = await sharing.createShare({
      workspaceId: "w1",
      target: "summary",
      includeProvenance: false,
    });
    await sharing.revokeShare(id);
    expect(await sharing.resolveShare(token)).toBeUndefined();
  });

  it("stops resolving after expiry", async () => {
    let clock = 1_000;
    const { sharing } = make(() => clock);
    const { token } = await sharing.createShare({
      workspaceId: "w1",
      target: "summary",
      includeProvenance: false,
      expiresInDays: 1,
    });
    expect(await sharing.resolveShare(token)).toBeDefined();
    clock += 2 * 24 * 60 * 60 * 1000; // jump two days
    expect(await sharing.resolveShare(token)).toBeUndefined();
  });

  it("lists a workspace's shares without exposing token material", async () => {
    const { sharing } = make();
    await sharing.createShare({ workspaceId: "w1", target: "a", includeProvenance: false });
    await sharing.createShare({ workspaceId: "w1", target: "b", includeProvenance: true });
    await sharing.createShare({ workspaceId: "w2", target: "c", includeProvenance: false });

    const list = await sharing.listShares("w1");
    expect(list.map((s) => s.target).sort()).toEqual(["a", "b"]);
    expect(JSON.stringify(list)).not.toMatch(/tokenHash/);
  });

  it("marks a listed share revoked after revocation", async () => {
    const { sharing } = make();
    const { id } = await sharing.createShare({ workspaceId: "w1", target: "a", includeProvenance: false });
    await sharing.revokeShare(id);
    const [only] = await sharing.listShares("w1");
    expect(only?.revoked).toBe(true);
  });
});
