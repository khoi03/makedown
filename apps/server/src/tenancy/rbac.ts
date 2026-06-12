/**
 * Role-based access control for org-scoped resources.
 *
 * A strict privilege hierarchy — viewer < member < admin < owner — keeps
 * authorization decisions a pure, total function of (role, action). Every
 * action declares the minimum role that may perform it; a role is authorized
 * iff its rank meets that minimum. Pure and dependency-free so it is trivially
 * testable and reusable on both the server and (later) the client.
 */

/** Org membership roles, in ascending privilege order. */
export const ROLES = ["viewer", "member", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

/** Every authorizable action in the tenancy layer. */
export type Action =
  | "workspace:read"
  | "workspace:build"
  | "workspace:snapshot"
  | "workspace:branch"
  | "workspace:create"
  | "approval:resolve"
  | "share:create"
  | "member:manage"
  | "org:delete";

/** Privilege rank per role (higher = more privileged). */
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** The minimum role required to perform each action. */
const MIN_ROLE: Record<Action, Role> = {
  "workspace:read": "viewer",
  "workspace:build": "member",
  "workspace:snapshot": "member",
  "workspace:branch": "member",
  "workspace:create": "member",
  "approval:resolve": "member",
  "share:create": "member",
  "member:manage": "admin",
  "org:delete": "owner",
};

/**
 * Whether `role` may perform `action`. Returns `false` for an unrecognized role
 * (defensive default-deny) rather than throwing.
 */
export function can(role: Role, action: Action): boolean {
  const rank = RANK[role];
  if (rank === undefined) return false;
  return rank >= RANK[MIN_ROLE[action]];
}
