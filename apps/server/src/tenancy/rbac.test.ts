import { describe, it, expect } from "vitest";
import { can, ROLES, type Role, type Action } from "./rbac.js";

/**
 * RBAC is a strict privilege hierarchy: viewer < member < admin < owner. A role
 * may perform an action iff its rank meets the action's minimum role. These
 * tests pin the full role × action matrix so a privilege regression can't slip
 * through silently.
 */
describe("can", () => {
  it("grants viewers read-only access (incl. analytics) and nothing else", () => {
    expect(can("viewer", "workspace:read")).toBe(true);
    expect(can("viewer", "analytics:read")).toBe(true);
    expect(can("viewer", "workspace:build")).toBe(false);
    expect(can("viewer", "workspace:snapshot")).toBe(false);
    expect(can("viewer", "member:manage")).toBe(false);
    expect(can("viewer", "org:delete")).toBe(false);
  });

  it("lets members build, snapshot, branch, approve, and share — but not manage members or delete the org", () => {
    const allowed: Action[] = [
      "workspace:read",
      "workspace:build",
      "workspace:snapshot",
      "workspace:branch",
      "workspace:create",
      "approval:resolve",
      "share:create",
    ];
    for (const action of allowed) expect(can("member", action)).toBe(true);
    expect(can("member", "member:manage")).toBe(false);
    expect(can("member", "org:delete")).toBe(false);
  });

  it("lets admins manage members but not delete the org", () => {
    expect(can("admin", "member:manage")).toBe(true);
    expect(can("admin", "workspace:build")).toBe(true);
    expect(can("admin", "org:delete")).toBe(false);
  });

  it("lets owners do everything, including delete the org", () => {
    expect(can("owner", "org:delete")).toBe(true);
    expect(can("owner", "member:manage")).toBe(true);
    expect(can("owner", "workspace:read")).toBe(true);
  });

  it("is monotonic — a higher role can do everything a lower role can", () => {
    const ranked: Role[] = ["viewer", "member", "admin", "owner"];
    const everyAction: Action[] = [
      "workspace:read",
      "workspace:build",
      "workspace:snapshot",
      "workspace:branch",
      "workspace:create",
      "approval:resolve",
      "share:create",
      "member:manage",
      "org:delete",
    ];
    for (let i = 0; i < ranked.length - 1; i++) {
      const lower = ranked[i]!;
      const higher = ranked[i + 1]!;
      for (const action of everyAction) {
        if (can(lower, action)) expect(can(higher, action)).toBe(true);
      }
    }
  });

  it("exposes the four roles in privilege order", () => {
    expect(ROLES).toEqual(["viewer", "member", "admin", "owner"]);
  });

  it("denies an unknown role defensively", () => {
    expect(can("nobody" as Role, "workspace:read")).toBe(false);
  });
});
