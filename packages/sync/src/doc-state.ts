/**
 * Yjs CRDT state persistence (distinct from the git/text materialization).
 *
 * Why this exists: loading the same *text* into a fresh Y.Doc each time the
 * server (re)opens a workspace is a Yjs anti-pattern — two independent docs that
 * each `insert(text)` then sync will MERGE both inserts (Yjs merges operations,
 * not final states), duplicating content and compounding on every reconnect.
 *
 * The fix is to persist the encoded CRDT state and restore it, so the doc keeps
 * a single, stable history across room recreations and server restarts. Restored
 * docs then sync idempotently. The git/text materialization remains the
 * source-of-truth for the engine + snapshots; this binary is just live-state
 * durability and lives under the gitignored `.makedown/`.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import * as Y from "yjs";

/** Path to a workspace's encoded Yjs state (under the gitignored `.makedown/`). */
export function docStatePath(dir: string): string {
  return join(dir, ".makedown", "sync", "ydoc.bin");
}

/** Persist the doc's full (compacted) CRDT state, overwriting any prior file. */
export async function saveDocState(doc: Y.Doc, dir: string): Promise<void> {
  const path = docStatePath(dir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Y.encodeStateAsUpdate(doc));
}

/**
 * Restore a workspace's CRDT state into `doc` if a saved state exists. Returns
 * `true` when state was applied, `false` on first-ever open (no file yet).
 */
export async function restoreDocState(doc: Y.Doc, dir: string): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(docStatePath(dir));
  } catch {
    return false;
  }
  Y.applyUpdate(doc, bytes);
  return true;
}
