/**
 * The sharing service: turns a built artifact into a public, read-only,
 * revocable link and resolves links back to their (workspace, target). It owns
 * token generation (reusing the tenancy crypto primitives — CSPRNG token,
 * SHA-256 at rest) and the liveness rules (revoked / expired), and delegates
 * persistence to a {@link ShareStore}. It does **not** enforce authorization —
 * the HTTP layer authorizes `share:create` before calling, exactly as it gates
 * every other workspace action.
 */
import { randomUUID } from "node:crypto";
import { generateSessionToken, hashToken } from "../tenancy/auth.js";
import type { Share, ShareSummary } from "./types.js";
import type { ShareStore } from "./store.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Bound link lifetime so a stray "expires in N days" can't become a century. */
const MAX_EXPIRY_DAYS = 365;

export interface CreateShareArgs {
  readonly workspaceId: string;
  readonly target: string;
  readonly includeProvenance: boolean;
  /** Optional lifetime in days; omitted/zero → a link that never expires. */
  readonly expiresInDays?: number;
}

export interface CreatedShare {
  readonly id: string;
  /** The raw bearer token — returned once, never persisted or re-derivable. */
  readonly token: string;
  /** The relative public path; the client prefixes its origin. */
  readonly path: string;
  readonly expiresAt: string | null;
}

export class SharingService {
  constructor(
    private readonly store: ShareStore,
    private readonly now: () => number = Date.now,
  ) {}

  async createShare(args: CreateShareArgs): Promise<CreatedShare> {
    const token = generateSessionToken();
    const id = randomUUID();
    const createdAt = new Date(this.now()).toISOString();
    const expiresAt = this.resolveExpiry(args.expiresInDays);
    await this.store.create({
      id,
      tokenHash: hashToken(token),
      workspaceId: args.workspaceId,
      target: args.target,
      includeProvenance: args.includeProvenance,
      createdAt,
      expiresAt,
    });
    return { id, token, path: `/s/${token}`, expiresAt };
  }

  /** Resolve a bearer token to its live share, or undefined if missing/revoked/expired. */
  async resolveShare(token: string): Promise<Share | undefined> {
    if (!token) return undefined;
    const share = await this.store.findByTokenHash(hashToken(token));
    if (!share || this.isDead(share)) return undefined;
    return share;
  }

  async listShares(workspaceId: string): Promise<ShareSummary[]> {
    const shares = await this.store.listForWorkspace(workspaceId);
    return shares
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({
        id: s.id,
        target: s.target,
        includeProvenance: s.includeProvenance,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        revoked: s.revokedAt !== null,
      }));
  }

  /** The workspace a share belongs to (for authorizing a revoke), or undefined. */
  async workspaceForShare(id: string): Promise<string | undefined> {
    return (await this.store.findById(id))?.workspaceId;
  }

  async revokeShare(id: string): Promise<void> {
    await this.store.revoke(id, new Date(this.now()).toISOString());
  }

  private isDead(share: Share): boolean {
    if (share.revokedAt !== null) return true;
    return share.expiresAt !== null && Date.parse(share.expiresAt) <= this.now();
  }

  private resolveExpiry(days: number | undefined): string | null {
    if (!days || days <= 0) return null;
    const clamped = Math.min(Math.floor(days), MAX_EXPIRY_DAYS);
    return new Date(this.now() + clamped * MS_PER_DAY).toISOString();
  }
}
