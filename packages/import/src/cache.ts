/**
 * Content-addressed conversion cache. Converting a binary source (especially a
 * large PDF or via an LLM-backed converter) is expensive, so we key the Markdown
 * result on a hash of **the source bytes + the importer id + its version + the
 * hints**. Identical bytes ⇒ a cache hit and zero reconversion; changed bytes or
 * an upgraded importer ⇒ a fresh conversion. This mirrors the engine's
 * content-hash (not mtime) philosophy and is the seam the future in-graph import
 * path (binary declared directly in `inputs:`) will reuse.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ImportRequest, Importer } from "./importer.js";

/** Hint subset of an {@link ImportRequest} (everything except the path). */
export type ImportHints = Omit<ImportRequest, "path">;

export interface ConversionIdInput {
  /** The raw bytes of the source file. */
  readonly bytes: Uint8Array;
  /** Importer id (e.g. "markitdown"). */
  readonly importerId: string;
  /** Importer version string. */
  readonly version: string;
  /** Format hints that influence the conversion. */
  readonly hints?: ImportHints;
}

/** Stable JSON: object keys sorted so equal hints hash equally. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** Compute the cache id for a conversion. Deterministic in all four dimensions. */
export function conversionId({ bytes, importerId, version, hints }: ConversionIdInput): string {
  const h = createHash("sha256");
  h.update("makedown-import-v1\n");
  h.update(`${importerId}\n`);
  h.update(`${version}\n`);
  h.update(`${canonicalJson(hints ?? {})}\n`);
  h.update(bytes);
  return `sha256:${h.digest("hex")}`;
}

/** A keyed store for converted Markdown. */
export interface ImportCacheStore {
  get(id: string): Promise<string | undefined>;
  set(id: string, markdown: string): Promise<void>;
}

const PREFIX = "sha256:";
const hex = (id: string): string => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id);

/**
 * Filesystem-backed cache, rooted at a directory (e.g. `<workspace>/.makedown/
 * imports`). Sharded by the first byte of the hash to keep directories small.
 */
export class FileImportCache implements ImportCacheStore {
  constructor(private readonly dir: string) {}

  private pathFor(id: string): string {
    const h = hex(id);
    return join(this.dir, h.slice(0, 2), `${h.slice(2)}.md`);
  }

  async get(id: string): Promise<string | undefined> {
    try {
      return await readFile(this.pathFor(id), "utf8");
    } catch {
      return undefined;
    }
  }

  async set(id: string, markdown: string): Promise<void> {
    const path = this.pathFor(id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, markdown, "utf8");
  }
}

export interface CachedImportInput {
  /** Absolute path to the source file (handed to the importer on a cache miss). */
  readonly path: string;
  /** The source file's bytes (used for the cache key). */
  readonly bytes: Uint8Array;
  /** Optional conversion hints. */
  readonly hints?: ImportHints;
}

export interface CachedImportResult {
  readonly markdown: string;
  /** True if served from cache (no reconversion happened). */
  readonly cached: boolean;
  /** The conversion cache id. */
  readonly id: string;
}

/**
 * Convert a source through the cache: on a hit, return the stored Markdown with
 * no reconversion; on a miss, run the importer and store the result.
 */
export async function importWithCache(
  importer: Importer,
  store: ImportCacheStore,
  input: CachedImportInput,
): Promise<CachedImportResult> {
  const version = await importer.version();
  const id = conversionId({
    bytes: input.bytes,
    importerId: importer.id,
    version,
    hints: input.hints,
  });

  const hit = await store.get(id);
  if (hit !== undefined) return { markdown: hit, cached: true, id };

  const result = await importer.convert({ path: input.path, ...input.hints });
  await store.set(id, result.markdown);
  return { markdown: result.markdown, cached: false, id };
}
