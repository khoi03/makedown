/**
 * Prompt-template interpolation and list parsing. Pure of any build state — these
 * helpers take a workspace directory (not a BuildContext) so both the build
 * orchestrator and the cost estimator can share them without a circular import.
 */
import { readFile } from "node:fs/promises";
import { bareRef } from "@makedown/format";
import { ImporterError } from "@makedown/import";
import { realResolveInWorkspace } from "./paths.js";
import type { ImportResolver } from "./imports.js";

const REF_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const HEAD_TAIL_RE = /^(head|tail)\((\d+)\)$/;

/**
 * Render a template (a prompt body or system prompt) by interpolating `{{ref}}`
 * (and `{{ref:head(n)}}`). In-memory `bindings` (e.g. a `map` step's `{{item}}`)
 * take precedence over file/artifact IO. When `previewMissingTargets` is true, an
 * unbuilt dependency artifact renders as a placeholder instead of throwing — used
 * by `md render`/`md cost` so prompts can be inspected before a build.
 */
export async function renderTemplate(
  text: string,
  workspaceDir: string,
  outputs: ReadonlyMap<string, string>,
  previewMissingTargets: boolean,
  bindings?: ReadonlyMap<string, string>,
  resolver?: ImportResolver,
): Promise<string> {
  return replaceAsync(text, REF_RE, async (inner) => {
    const trimmed = inner.trim();
    const ref = bareRef(trimmed);
    const suffix = suffixOf(trimmed);
    const bound = bindings?.get(ref);
    if (bound !== undefined) return applySuffix(bound, suffix);
    try {
      const content = await readRefContent(ref, workspaceDir, outputs, resolver);
      return applySuffix(content, suffix);
    } catch (err) {
      if (previewMissingTargets && outputs.has(ref)) return `«unbuilt artifact: ${ref}»`;
      // In preview (md render/cost), tolerate an unavailable importer rather than
      // failing the whole inspection — show a placeholder for the binary source.
      if (previewMissingTargets && err instanceof ImporterError) {
        return `«unconverted source: ${ref}»`;
      }
      throw err;
    }
  });
}

/**
 * Read a ref's content: a target ref reads its artifact's output file (always
 * Markdown); a source reads the file — auto-converting it to Markdown when it is
 * an importable binary and a {@link ImportResolver} is provided.
 */
export async function readRefContent(
  ref: string,
  workspaceDir: string,
  outputs: ReadonlyMap<string, string>,
  resolver?: ImportResolver,
): Promise<string> {
  const isTarget = outputs.has(ref);
  const path = outputs.get(ref) ?? ref;
  // Confine every interpolated/over read to the workspace (throws on escape).
  const abs = await realResolveInWorkspace(workspaceDir, path);
  // Only a *source* ref can be importable — a target's artifact is produced Markdown.
  if (!isTarget && resolver?.isImportable(ref)) {
    return resolver.resolveText(abs, ref);
  }
  const bytes = await readFile(abs);
  return new TextDecoder().decode(bytes);
}

/**
 * Parse a `map` source into items: a JSON array (each element stringified) when
 * the content is one, else newline-delimited (blank lines dropped).
 */
export function parseList(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
      }
    } catch {
      // Not valid JSON — fall through to newline mode.
    }
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function suffixOf(inner: string): string | undefined {
  const colon = inner.indexOf(":");
  return colon === -1 ? undefined : inner.slice(colon + 1);
}

/** Apply a supported body-transform suffix. Pre-1.0: only head/tail (SPEC §5/§11). */
function applySuffix(content: string, suffix: string | undefined): string {
  if (!suffix) return content;
  const m = HEAD_TAIL_RE.exec(suffix);
  if (!m) return content; // unknown suffix: ignore for now
  const n = Number(m[2]);
  const lines = content.split(/\r?\n/);
  return m[1] === "head" ? lines.slice(0, n).join("\n") : lines.slice(-n).join("\n");
}

async function replaceAsync(
  str: string,
  regex: RegExp,
  fn: (group: string) => Promise<string>,
): Promise<string> {
  const matches = [...str.matchAll(regex)];
  const replacements = await Promise.all(matches.map((m) => fn(m[1] ?? "")));
  let result = "";
  let last = 0;
  matches.forEach((m, i) => {
    const index = m.index ?? 0;
    result += str.slice(last, index) + (replacements[i] ?? "");
    last = index + m[0].length;
  });
  return result + str.slice(last);
}
