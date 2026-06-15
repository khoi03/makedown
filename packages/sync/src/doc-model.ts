/**
 * The Yjs workspace document model.
 *
 * A workspace's *live, collaborative* state is a single {@link Y.Doc}:
 *   - `build.md`  -> a top-level {@link Y.Text} (the literate build spec)
 *   - sources     -> a {@link Y.Map} of `path -> Y.Text`
 *
 * This is the CRDT half of the §6 boundary: text edits merge here without
 * conflict. The git half (snapshots/branches) materializes from and reloads
 * into this doc via {@link loadSnapshot} / {@link applySnapshot}.
 */
import * as Y from "yjs";

/** Y.Doc key under which the `build.md` text lives. */
export const BUILD_DOC_KEY = "build.md";
/** Y.Doc key under which the `path -> Y.Text` source map lives. */
export const SOURCES_KEY = "sources";

/** A plain, serializable view of a workspace — the bridge to/from git. */
export interface WorkspaceSnapshot {
  /** Full text of `build.md`. */
  readonly buildMd: string;
  /** Map of source path (relative, POSIX) -> file text. */
  readonly sources: Readonly<Record<string, string>>;
}

/** The live `build.md` Y.Text. Bind an editor to this. */
export function getBuildText(doc: Y.Doc): Y.Text {
  return doc.getText(BUILD_DOC_KEY);
}

/** The `path -> Y.Text` source map. */
function sourcesMap(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>(SOURCES_KEY);
}

/**
 * The live Y.Text for a source path, creating (and integrating) an empty one on
 * first access so editors can bind to a path before its file exists.
 */
export function getSourceText(doc: Y.Doc, path: string): Y.Text {
  const sources = sourcesMap(doc);
  let text = sources.get(path);
  if (!text) {
    text = new Y.Text();
    sources.set(path, text);
  }
  return text;
}

/** Every source path currently present in the document. */
export function listSourcePaths(doc: Y.Doc): string[] {
  return [...sourcesMap(doc).keys()];
}

/** Read the document's current state as a plain snapshot (no live references). */
export function loadSnapshot(doc: Y.Doc): WorkspaceSnapshot {
  const sources: Record<string, string> = {};
  for (const [path, text] of sourcesMap(doc).entries()) {
    sources[path] = text.toString();
  }
  return { buildMd: getBuildText(doc).toString(), sources };
}

/**
 * Reconcile the document to match `snapshot` in a single transaction.
 *
 * Reconciling (rather than wiping and rewriting) keeps a Y.Text's identity and
 * history when its content is unchanged — so reloading a git snapshot doesn't
 * churn the CRDT or disrupt other replicas' cursors on untouched files.
 */
export function applySnapshot(doc: Y.Doc, snapshot: WorkspaceSnapshot): void {
  doc.transact(() => {
    replaceText(getBuildText(doc), snapshot.buildMd);

    const sources = sourcesMap(doc);
    for (const path of [...sources.keys()]) {
      if (!(path in snapshot.sources)) sources.delete(path);
    }
    for (const [path, content] of Object.entries(snapshot.sources)) {
      replaceText(getSourceText(doc, path), content);
    }
  });
}

/**
 * Reconcile a Y.Text to `content`, mutating only the span that actually changed.
 *
 * Instead of a blunt delete-all + insert-all, trim the common prefix and suffix
 * and replace just the differing middle. On a *live* doc (a branch switch /
 * reload while clients are connected) this matters a lot: churning the whole
 * Y.Text interleaves with concurrent client edits (scrambling text) and destroys
 * every collaborator's cursor. Touching only the changed middle keeps the
 * unchanged head/tail items — and the cursors anchored to them — intact, and
 * shrinks the interleave surface to just the region that genuinely changed.
 */
function replaceText(text: Y.Text, content: string): void {
  const current = text.toString();
  if (current === content) return;

  const maxPrefix = Math.min(current.length, content.length);
  let prefix = 0;
  while (prefix < maxPrefix && current[prefix] === content[prefix]) prefix++;

  // Longest common suffix, clamped so it never overlaps the matched prefix in
  // either string (avoids double-counting shared chars, e.g. "aaaa" -> "aa").
  const maxSuffix = Math.min(current.length - prefix, content.length - prefix);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === content[content.length - 1 - suffix]
  ) {
    suffix++;
  }

  const removeCount = current.length - prefix - suffix;
  if (removeCount > 0) text.delete(prefix, removeCount);
  const inserted = content.slice(prefix, content.length - suffix);
  if (inserted.length > 0) text.insert(prefix, inserted);
}
