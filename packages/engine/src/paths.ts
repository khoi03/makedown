/**
 * Workspace path confinement (Phase 1.5 hardening). A `build.md` declares
 * relative paths for sources, outputs, transform scripts, and `over` lists. To
 * run an untrusted `build.md` safely, every path the engine touches must stay
 * inside the workspace root — no `..` escapes, no absolute paths, and no
 * symlinks that point outside.
 *
 * Two guards:
 * - `resolveInWorkspace` — a pure, synchronous *lexical* check (no IO): rejects
 *   absolute paths (POSIX or Windows form, regardless of host OS) and any path
 *   that normalizes outside the root.
 * - `realResolveInWorkspace` — adds a filesystem `realpath` check so a symlink
 *   inside the workspace can't redirect a read/write outside it.
 */
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";

/** Thrown when a declared path would escape the workspace root. */
export class PathEscapeError extends Error {
  constructor(relPath: string, reason: string) {
    super(`Path "${relPath}" ${reason} — declared paths must stay inside the workspace`);
    this.name = "PathEscapeError";
  }
}

/** Absolute in *either* POSIX or Windows semantics, so the check holds on any host. */
function isAbsoluteAnyOs(p: string): boolean {
  return isAbsolute(p) || posix.isAbsolute(p) || win32.isAbsolute(p);
}

/** Whether `child` is the same as, or nested under, `root` (both already absolute). */
function isWithin(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Resolve a workspace-relative path to an absolute path, asserting it stays
 * inside the workspace. Pure and synchronous — no filesystem access. Throws
 * {@link PathEscapeError} on any escape.
 */
export function resolveInWorkspace(workspaceDir: string, relPath: string): string {
  if (relPath.includes("\0")) {
    throw new PathEscapeError(relPath, "contains a NUL byte");
  }
  if (isAbsoluteAnyOs(relPath)) {
    throw new PathEscapeError(relPath, "is an absolute path");
  }
  const root = resolve(workspaceDir);
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PathEscapeError(relPath, "escapes the workspace root");
  }
  return abs;
}

/**
 * Like {@link resolveInWorkspace}, but also follows symlinks: the deepest
 * existing ancestor of the target is `realpath`-resolved and must still fall
 * inside the (real) workspace root. This catches a symlink placed inside the
 * workspace that redirects to an external location — for reads (the symlinked
 * file itself) and writes (a symlinked parent directory). The non-existent
 * suffix of an output path is safe because the lexical guard already forbade
 * `..`, so it cannot climb out of a contained ancestor.
 */
export async function realResolveInWorkspace(
  workspaceDir: string,
  relPath: string,
): Promise<string> {
  const abs = resolveInWorkspace(workspaceDir, relPath);
  const rootReal = await realpath(resolve(workspaceDir));
  const ancestorReal = await realpathDeepestExisting(abs);
  if (!isWithin(rootReal, ancestorReal)) {
    throw new PathEscapeError(relPath, "resolves through a symlink outside the workspace");
  }
  return abs;
}

/** `realpath` the deepest ancestor of `abs` that exists (abs itself if it does). */
async function realpathDeepestExisting(abs: string): Promise<string> {
  let current = abs;
  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return current; // reached a root that doesn't resolve
      current = parent;
    }
  }
}
