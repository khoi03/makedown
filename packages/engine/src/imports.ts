/**
 * In-graph auto-import — the resolver that lets a non-Markdown file be referenced
 * *directly* in a target's `inputs:` (and body, via `{{sources/report.pdf}}`).
 *
 * On resolve, a file whose extension is in the importable set is converted to
 * Markdown through the injected {@link Importer} (the same `@makedown/import` seam
 * the explicit `md import` command uses), and the result is cached by content
 * hash. Native text files (`.md`, `.csv`, `.txt`, …) are left exactly as before —
 * the importable set is an allow-list, so existing behavior never changes.
 *
 * Two consumption paths route through one resolver so a binary is converted
 * consistently and at most once per build:
 *   - **hashing** ({@link ImportResolver.inputHash}) folds the conversion identity
 *     (bytes + importer + version + hints) into the target's identity hash, so
 *     editing the binary *or* upgrading the importer restales downstream targets;
 *   - **content** ({@link ImportResolver.resolveText}) returns the converted
 *     Markdown that prompts and transforms actually consume.
 *
 * The file is named in `build.md` (author-controlled, not a CLI argument), so the
 * caller must confine its path to the workspace before any IO — see
 * {@link realResolveInWorkspace}, applied by the engine's input/ref readers.
 */
import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import {
  conversionId,
  importWithCache,
  ImporterError,
  type Importer,
  type ImportCacheStore,
  type ImportHints,
} from "@makedown/import";
import type { ImportedSource } from "@makedown/shared";
import { sha256 } from "./hash.js";

/**
 * File extensions auto-converted to Markdown on resolve. An explicit allow-list of
 * the rich/binary formats MarkItDown handles well — everything else (incl. `.md`,
 * `.txt`, `.csv`, `.json`, `.yaml`) is read as-is, so no existing build changes.
 */
export const DEFAULT_IMPORTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls",
  ".epub",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
]);

export interface ImportResolverOptions {
  readonly importer?: Importer;
  readonly importCache?: ImportCacheStore;
  /** Defaults to {@link DEFAULT_IMPORTABLE_EXTENSIONS}. */
  readonly importableExtensions?: ReadonlySet<string>;
}

export interface InputHashResult {
  readonly hash: string;
  /** Set when the hash is a real conversion id (importer available). */
  readonly imported?: ImportedSource;
}

/**
 * Resolves importable sources to Markdown + their content hash. Construct one per
 * build (the importer's version probe is memoized across the whole build so it
 * shells out at most once).
 */
export class ImportResolver {
  private readonly importer?: Importer;
  private readonly importCache?: ImportCacheStore;
  private readonly extensions: ReadonlySet<string>;
  private versionProbe?: Promise<string | undefined>;

  constructor(options: ImportResolverOptions = {}) {
    this.importer = options.importer;
    this.importCache = options.importCache;
    this.extensions = options.importableExtensions ?? DEFAULT_IMPORTABLE_EXTENSIONS;
  }

  /** Whether a ref's extension marks it for auto-conversion. Purely lexical. */
  isImportable(ref: string): boolean {
    return this.extensions.has(extname(ref).toLowerCase());
  }

  /**
   * Content hash for an importable source. With an available importer this is the
   * conversion id (so an importer upgrade restales); when the tool is absent we
   * degrade to a raw-bytes hash so `md status`/`md cost` stay stable — an actual
   * build's content path then fails loudly via {@link resolveText}.
   */
  async inputHash(bytes: Uint8Array, ref: string): Promise<InputHashResult> {
    const version = await this.probeVersion();
    if (this.importer && version !== undefined) {
      const id = conversionId({
        bytes,
        importerId: this.importer.id,
        version,
        hints: hintsFor(ref),
      });
      return { hash: id, imported: { importer: this.importer.id, conversionId: id } };
    }
    return { hash: sha256(bytes) };
  }

  /**
   * Convert an importable source to Markdown, served from the cache when the bytes
   * (and importer version) are unchanged. Throws {@link ImporterError} when no
   * importer is configured or the tool is unavailable — a build must fail clearly,
   * never decode binary bytes as text.
   */
  async resolveText(absPath: string, ref: string): Promise<string> {
    if (!this.importer) {
      throw new ImporterError(
        "not_installed",
        `No importer configured to auto-import "${ref}". ` +
          `Install MarkItDown (pip install 'markitdown[all]') or convert it with \`md import\` first.`,
      );
    }
    const bytes = new Uint8Array(await readFile(absPath));
    if (!this.importCache) {
      const result = await this.importer.convert({ path: absPath, ...hintsFor(ref) });
      return result.markdown;
    }
    const { markdown } = await importWithCache(this.importer, this.importCache, {
      path: absPath,
      bytes,
      hints: hintsFor(ref),
    });
    return markdown;
  }

  /** Memoized importer version; undefined when no importer or the tool is absent. */
  private async probeVersion(): Promise<string | undefined> {
    if (!this.importer) return undefined;
    if (!this.versionProbe) {
      this.versionProbe = this.importer.version().catch(() => undefined);
    }
    return this.versionProbe;
  }
}

/** Conversion hints derived from a ref — currently just the extension. */
function hintsFor(ref: string): ImportHints {
  return { extensionHint: extname(ref) };
}
