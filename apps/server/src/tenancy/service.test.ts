import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryTenancyStore } from "./memory-store.js";
import { TenancyService } from "./service.js";
import { NullTenancy } from "./null-tenancy.js";
import { createTenancy } from "./index.js";
import type { TenancyProvider } from "./provider.js";

/**
 * The service composes auth + RBAC + the store into the operations the HTTP
 * layer needs. Tests run against the in-memory store, exercising the full
 * signup → login → authenticate → authorize flow end to end, plus the
 * permissive NullTenancy passthrough and the env-driven factory.
 */
describe("TenancyService", () => {
  let service: TenancyService;
  beforeEach(() => {
    service = new TenancyService(new InMemoryTenancyStore());
  });

  it("is enabled", () => {
    expect(service.enabled).toBe(true);
  });

  describe("signup / login / authenticate", () => {
    it("signs up a user with a personal owner org and an active session", async () => {
      const result = await service.signup("founder@example.com", "hunter2hunter2");
      expect(result.user.email).toBe("founder@example.com");
      expect(result.org.id).toBeTruthy();
      expect(result.token).toBeTruthy();

      const principal = await service.authenticate(result.token);
      expect(principal).toMatchObject({ userId: result.user.id, email: "founder@example.com" });

      // the signing-up user owns their personal org
      const orgs = await service.listOrgs(result.user.id);
      expect(orgs).toHaveLength(1);
    });

    it("rejects duplicate signups", async () => {
      await service.signup("dup@example.com", "password-one");
      await expect(service.signup("dup@example.com", "password-two")).rejects.toThrow();
    });

    it("logs in with correct credentials and rejects wrong ones", async () => {
      await service.signup("user@example.com", "right-password");
      expect(await service.login("user@example.com", "right-password")).toBeTruthy();
      expect(await service.login("user@example.com", "wrong-password")).toBeUndefined();
      // unknown user — same undefined result, no enumeration signal
      expect(await service.login("ghost@example.com", "whatever-pass")).toBeUndefined();
    });

    it("returns undefined for a missing, bogus, or logged-out token", async () => {
      expect(await service.authenticate(undefined)).toBeUndefined();
      expect(await service.authenticate("not-a-real-token")).toBeUndefined();
      const { token } = await service.signup("logout@example.com", "password-xyz");
      await service.logout(token);
      expect(await service.authenticate(token)).toBeUndefined();
    });

    it("enforces a minimum password length", async () => {
      await expect(service.signup("short@example.com", "short")).rejects.toThrow();
    });
  });

  describe("authorize", () => {
    it("authorizes by the member's role on the workspace's org", async () => {
      const { user, org } = await service.signup("owner@example.com", "owner-password");
      const ws = await service.createWorkspace({
        id: "proj",
        orgId: org.id,
        slug: "proj",
        userId: user.id,
      });

      // owner can do everything
      expect(await service.authorize(user.id, ws.id, "workspace:build")).toBe(true);
      expect(await service.authorize(user.id, ws.id, "org:delete")).toBe(true);

      // a viewer in the same org can read but not build
      const viewer = await service.signup("viewer@example.com", "viewer-password");
      await service.addMemberByEmail(org.id, "viewer@example.com", "viewer");
      expect(await service.authorize(viewer.user.id, ws.id, "workspace:read")).toBe(true);
      expect(await service.authorize(viewer.user.id, ws.id, "workspace:build")).toBe(false);
    });

    it("denies a user with no membership in the workspace's org", async () => {
      const { user, org } = await service.signup("a@example.com", "a-password-123");
      const ws = await service.createWorkspace({ id: "p", orgId: org.id, slug: "p", userId: user.id });
      const outsider = await service.signup("b@example.com", "b-password-123");
      expect(await service.authorize(outsider.user.id, ws.id, "workspace:read")).toBe(false);
    });

    it("denies any action on an unknown workspace", async () => {
      const { user } = await service.signup("c@example.com", "c-password-123");
      expect(await service.authorize(user.id, "ghost-ws", "workspace:read")).toBe(false);
    });
  });

  describe("accessibleWorkspaceIds", () => {
    it("returns only workspaces in the user's orgs", async () => {
      const { user, org } = await service.signup("owner2@example.com", "owner2-password");
      await service.createWorkspace({ id: "w1", orgId: org.id, slug: "w1", userId: user.id });
      await service.createWorkspace({ id: "w2", orgId: org.id, slug: "w2", userId: user.id });

      const other = await service.signup("other@example.com", "other-password");
      await service.createWorkspace({
        id: "w3",
        orgId: other.org.id,
        slug: "w3",
        userId: other.user.id,
      });

      const ids = await service.accessibleWorkspaceIds(user.id);
      expect(ids).toEqual(new Set(["w1", "w2"]));
    });
  });

  describe("recordProvenance", () => {
    it("indexes rows, resolving the org from the workspace", async () => {
      const { user, org } = await service.signup("p@example.com", "p-password-123");
      const ws = await service.createWorkspace({ id: "wp", orgId: org.id, slug: "wp", userId: user.id });
      await service.recordProvenance(ws.id, [
        {
          id: "sha256:1",
          workspaceId: ws.id,
          target: "t",
          step: "chat",
          model: "claude-opus-4-8",
          tokensInput: 10,
          tokensOutput: 5,
          costUsd: 0.001,
          producedAt: "2026-06-12T00:00:00Z",
        },
      ]);
      const rows = await service.listProvenance(ws.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.orgId).toBe(org.id);
    });

    it("silently ignores provenance for an unknown workspace (best-effort index)", async () => {
      await expect(
        service.recordProvenance("ghost", [
          {
            id: "sha256:x",
            workspaceId: "ghost",
            target: "t",
            step: "chat",
            model: null,
            tokensInput: 0,
            tokensOutput: 0,
            costUsd: 0,
            producedAt: "2026-06-12T00:00:00Z",
          },
        ]),
      ).resolves.toBeUndefined();
    });
  });
});

describe("NullTenancy", () => {
  const tenancy: TenancyProvider = new NullTenancy();

  it("is disabled and permissive", async () => {
    expect(tenancy.enabled).toBe(false);
    expect(await tenancy.authorize("anyone", "any-ws", "org:delete")).toBe(true);
    expect(await tenancy.accessibleWorkspaceIds("anyone")).toBeUndefined();
  });

  it("resolves no principal (auth is off) and no-ops provenance", async () => {
    expect(await tenancy.authenticate("x")).toBeUndefined();
    await expect(tenancy.recordProvenance("w", [])).resolves.toBeUndefined();
  });

  it("refuses auth operations because auth is disabled", async () => {
    await expect(tenancy.signup("a@b.com", "password-123")).rejects.toThrow();
    expect(await tenancy.login("a@b.com", "password-123")).toBeUndefined();
  });
});

describe("createTenancy factory", () => {
  it("returns NullTenancy when no DATABASE_URL is set", () => {
    const tenancy = createTenancy({ env: {} });
    expect(tenancy.enabled).toBe(false);
  });

  it("returns an enabled service when an explicit store is provided", () => {
    const tenancy = createTenancy({ env: {}, store: new InMemoryTenancyStore() });
    expect(tenancy.enabled).toBe(true);
  });
});
