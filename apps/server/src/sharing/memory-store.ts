/**
 * In-memory {@link ShareStore}. Used by the test suite and viable for a small
 * single-process self-host. Stores and returns defensive copies so callers can
 * never mutate persisted state by reference (the codebase immutability rule).
 */
import type { Share } from "./types.js";
import type { ShareStore, CreateShareInput } from "./store.js";

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryShareStore implements ShareStore {
  private readonly byId = new Map<string, Share>();

  async create(input: CreateShareInput): Promise<Share> {
    const share: Share = { ...input, revokedAt: null };
    this.byId.set(share.id, share);
    return clone(share);
  }

  async findByTokenHash(tokenHash: string): Promise<Share | undefined> {
    for (const share of this.byId.values()) {
      if (share.tokenHash === tokenHash) return clone(share);
    }
    return undefined;
  }

  async findById(id: string): Promise<Share | undefined> {
    const share = this.byId.get(id);
    return share ? clone(share) : undefined;
  }

  async listForWorkspace(workspaceId: string): Promise<Share[]> {
    return [...this.byId.values()].filter((s) => s.workspaceId === workspaceId).map(clone);
  }

  async revoke(id: string, revokedAt: string): Promise<void> {
    const existing = this.byId.get(id);
    if (existing && !existing.revokedAt) this.byId.set(id, { ...existing, revokedAt });
  }
}
