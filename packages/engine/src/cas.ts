/**
 * Content-addressed store (CAS). Artifacts and their provenance are keyed by
 * identity hash so rebuilds are a cache lookup. Local filesystem implementation;
 * the commercial cloud swaps in an object-store-backed Cas behind the same
 * interface.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Provenance } from "@makedown/shared";

export interface Cas {
  has(id: string): Promise<boolean>;
  get(id: string): Promise<Uint8Array | undefined>;
  put(id: string, content: Uint8Array): Promise<void>;
  getProvenance(id: string): Promise<Provenance | undefined>;
  putProvenance(provenance: Provenance): Promise<void>;
}

const PREFIX = "sha256:";

function hex(id: string): string {
  return id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Local filesystem CAS, rooted at `<workspace>/.makedown`. */
export class LocalCas implements Cas {
  constructor(private readonly root: string) {}

  private objectPath(id: string): string {
    const h = hex(id);
    return join(this.root, "objects", h.slice(0, 2), h.slice(2));
  }

  private provenancePath(id: string): string {
    return join(this.root, "provenance", `${hex(id)}.json`);
  }

  async has(id: string): Promise<boolean> {
    return exists(this.objectPath(id));
  }

  async get(id: string): Promise<Uint8Array | undefined> {
    const path = this.objectPath(id);
    if (!(await exists(path))) return undefined;
    return new Uint8Array(await readFile(path));
  }

  async put(id: string, content: Uint8Array): Promise<void> {
    const path = this.objectPath(id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  async getProvenance(id: string): Promise<Provenance | undefined> {
    const path = this.provenancePath(id);
    if (!(await exists(path))) return undefined;
    return JSON.parse(await readFile(path, "utf8")) as Provenance;
  }

  async putProvenance(provenance: Provenance): Promise<void> {
    const path = this.provenancePath(provenance.id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(provenance, null, 2), "utf8");
  }
}
