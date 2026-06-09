/**
 * Content-addressed store (CAS). Artifacts and their provenance are keyed by
 * identity hash so rebuilds are a cache lookup. Local filesystem implementation;
 * the commercial cloud swaps in an object-store-backed Cas behind the same
 * interface.
 */
import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Provenance } from "@makedown/shared";

/** One stochastic sample to persist: its content and provenance under an id. */
export interface SampleInput {
  readonly id: string;
  readonly index: number;
  readonly content: Uint8Array;
  readonly provenance: Provenance;
}

export interface Cas {
  has(id: string): Promise<boolean>;
  get(id: string): Promise<Uint8Array | undefined>;
  put(id: string, content: Uint8Array): Promise<void>;
  getProvenance(id: string): Promise<Provenance | undefined>;
  putProvenance(provenance: Provenance): Promise<void>;

  // Stochastic sampling (SPEC §7): up to k sibling samples per identity hash,
  // with a "blessed" pointer selecting which one downstream targets consume.
  countSamples(id: string): Promise<number>;
  putSample(sample: SampleInput): Promise<void>;
  getSample(id: string, index: number): Promise<Uint8Array | undefined>;
  getSampleProvenance(id: string, index: number): Promise<Provenance | undefined>;
  getBlessed(id: string): Promise<number>;
  setBlessed(id: string, index: number): Promise<void>;
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

  private samplesDir(id: string): string {
    return join(this.root, "samples", hex(id));
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

  async countSamples(id: string): Promise<number> {
    try {
      const entries = await readdir(this.samplesDir(id));
      return entries.filter((name) => /^\d+$/.test(name)).length;
    } catch {
      return 0;
    }
  }

  async putSample({ id, index, content, provenance }: SampleInput): Promise<void> {
    const dir = this.samplesDir(id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, String(index)), content);
    await writeFile(join(dir, `${index}.json`), JSON.stringify(provenance, null, 2), "utf8");
  }

  async getSample(id: string, index: number): Promise<Uint8Array | undefined> {
    const path = join(this.samplesDir(id), String(index));
    if (!(await exists(path))) return undefined;
    return new Uint8Array(await readFile(path));
  }

  async getSampleProvenance(id: string, index: number): Promise<Provenance | undefined> {
    const path = join(this.samplesDir(id), `${index}.json`);
    if (!(await exists(path))) return undefined;
    return JSON.parse(await readFile(path, "utf8")) as Provenance;
  }

  async getBlessed(id: string): Promise<number> {
    const path = join(this.samplesDir(id), "blessed");
    if (!(await exists(path))) return 0;
    const n = Number((await readFile(path, "utf8")).trim());
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  async setBlessed(id: string, index: number): Promise<void> {
    const dir = this.samplesDir(id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "blessed"), String(index), "utf8");
  }
}
