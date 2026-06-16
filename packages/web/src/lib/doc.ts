/**
 * Browser-side accessors for the Yjs workspace document.
 *
 * The server's authoritative model lives in `@makedown/sync` (`build.md` as a
 * top-level Y.Text, sources as a `Y.Map<path, Y.Text>`), but that package pulls
 * in Node/git internals and is not browser-bundle-safe. These few accessors
 * mirror that shape so the web client can read the same synced doc directly —
 * no extra server round-trip for listing or opening files.
 */
import * as Y from "yjs";

/** The build spec's path; the one file that is a top-level Y.Text, not a source. */
export const BUILD_FILE = "build.md";

/** Y.Doc key under which the `path -> Y.Text` source map lives (matches the server). */
export const SOURCES_KEY = "sources";

/** The live `path -> Y.Text` source map. */
export function sourcesMap(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>(SOURCES_KEY);
}

/** Every source path currently in the doc, sorted for a stable list order. */
export function sourcePaths(doc: Y.Doc): string[] {
  return [...sourcesMap(doc).keys()].sort((a, b) => a.localeCompare(b));
}

/**
 * The live Y.Text for a source path, creating (and integrating) an empty one on
 * first access so an editor can bind before the file has any content.
 */
export function sourceText(doc: Y.Doc, path: string): Y.Text {
  const sources = sourcesMap(doc);
  let text = sources.get(path);
  if (!text) {
    text = new Y.Text();
    sources.set(path, text);
  }
  return text;
}

/** Resolve any workspace file path to its live Y.Text (`build.md` is special-cased). */
export function fileText(doc: Y.Doc, path: string): Y.Text {
  return path === BUILD_FILE ? doc.getText(BUILD_FILE) : sourceText(doc, path);
}
