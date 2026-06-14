/**
 * File-backed {@link ShareStore} — the no-database persistence path. Shares live
 * in one server-level JSON registry (`<root>/.makedown-shares.json`) keyed by
 * share id, so the public `/s/:token` route can resolve a token globally without
 * knowing the workspace, and links survive a restart.
 *
 * Writes are serialized through a single-writer chain and committed atomically
 * (write a temp file, then rename) so a crash mid-write can never corrupt the
 * registry or leave a partial file in its place.
 */
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Share } from "./types.js";
import type { ShareStore, CreateShareInput } from "./store.js";

const REGISTRY_FILE = ".makedown-shares.json";
const clone = <T>(value: T): T => structuredClone(value);

export class FileShareStore implements ShareStore {
  private readonly path: string;
  private cache: Map<string, Share> | undefined;
  /** Serializes load + mutations so concurrent writes can't interleave. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.path = join(root, REGISTRY_FILE);
  }

  async create(input: CreateShareInput): Promise<Share> {
    const share: Share = { ...input, revokedAt: null };
    await this.mutate((shares) => shares.set(share.id, share));
    return clone(share);
  }

  async findByTokenHash(tokenHash: string): Promise<Share | undefined> {
    const shares = await this.load();
    for (const share of shares.values()) {
      if (share.tokenHash === tokenHash) return clone(share);
    }
    return undefined;
  }

  async findById(id: string): Promise<Share | undefined> {
    const share = (await this.load()).get(id);
    return share ? clone(share) : undefined;
  }

  async listForWorkspace(workspaceId: string): Promise<Share[]> {
    const shares = await this.load();
    return [...shares.values()].filter((s) => s.workspaceId === workspaceId).map(clone);
  }

  async revoke(id: string, revokedAt: string): Promise<void> {
    await this.mutate((shares) => {
      const existing = shares.get(id);
      if (existing && !existing.revokedAt) shares.set(id, { ...existing, revokedAt });
    });
  }

  /** Read the registry into memory once; subsequent reads use the cache. */
  private async load(): Promise<Map<string, Share>> {
    if (this.cache) return this.cache;
    this.chain = this.chain.then(() => this.readFromDisk());
    await this.chain;
    return this.cache!;
  }

  private async readFromDisk(): Promise<void> {
    if (this.cache) return;
    try {
      const text = await readFile(this.path, "utf8");
      const record = JSON.parse(text) as Record<string, Share>;
      this.cache = new Map(Object.entries(record));
    } catch {
      // Missing or unreadable registry → start empty (first share creates it).
      this.cache = new Map();
    }
  }

  /** Apply a mutation under the write lock, then atomically persist. */
  private async mutate(apply: (shares: Map<string, Share>) => void): Promise<void> {
    this.chain = this.chain
      .then(() => this.readFromDisk())
      .then(async () => {
        apply(this.cache!);
        await this.persist(this.cache!);
      });
    await this.chain;
  }

  private async persist(shares: Map<string, Share>): Promise<void> {
    const record = Object.fromEntries(shares);
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
    await rename(tmp, this.path); // atomic replace on POSIX and Windows
  }
}
