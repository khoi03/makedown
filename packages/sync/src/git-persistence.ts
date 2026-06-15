/**
 * Git-backed persistence — the git half of the §6 collaboration boundary.
 *
 * The live Y.Doc is the source of truth while editing; this module materializes
 * it to the working tree (so the OSS engine can build the current text) and
 * commits *snapshots* (the VCS half). Branches let a team "try a different
 * prompt graph"; switching a branch reloads the doc from that branch's content.
 *
 * Git is invoked via `execFile` with argv arrays (never a shell), mirroring the
 * engine's sandbox discipline.
 */
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as Y from "yjs";
import { loadSnapshot, applySnapshot, type WorkspaceSnapshot } from "./doc-model.js";
import { saveDocState, saveDocStateSync } from "./doc-state.js";

const exec = promisify(execFile);

/** Name of the literate build spec at the workspace root. */
const BUILD_FILE = "build.md";
/** Directory (relative to the workspace root) whose files are collaborative sources. */
const SOURCES_DIR = "sources";

/**
 * Normalize line endings to LF. The collaborative Y.Text — and CodeMirror, which
 * binds to it — are LF-only: CodeMirror silently normalizes input to `\n`, so any
 * CRLF that reaches the Y.Text makes the editor SHORTER than the Y.Text and
 * y-codemirror writes edits at the wrong offset, scrambling the doc. Windows
 * checkouts (git core.autocrlf) routinely leave `\r\n` in `build.md`, so we strip
 * `\r` at every disk-read boundary that feeds the live doc.
 */
function normalizeEol(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

/** Commit author for snapshots when none is supplied. */
export interface GitAuthor {
  readonly name: string;
  readonly email: string;
}
const DEFAULT_AUTHOR: GitAuthor = { name: "Makedown", email: "makedown@local" };

/** One VCS snapshot (a git commit). */
export interface Snapshot {
  readonly sha: string;
  readonly message: string;
  /** ISO 8601 commit date. */
  readonly date: string;
  readonly author: string;
}

export interface PersistenceOptions {
  /** Author recorded on commits. Defaults to a generic Makedown identity. */
  readonly author?: GitAuthor;
}

async function git(dir: string, args: readonly string[]): Promise<string> {
  const { stdout } = await exec("git", args as string[], { cwd: dir, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Recursively list files under `root`, returned as POSIX paths relative to `dir`. */
async function walk(dir: string, root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return []; // missing dir -> no sources
  }
  const out: string[] = [];
  for (const entry of entries) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(dir, abs)));
    } else if (entry.isFile()) {
      out.push(relative(dir, abs).split(sep).join("/"));
    }
  }
  return out;
}

/**
 * Read the workspace's `build.md` + everything under `sources/` into a plain
 * snapshot. The collaborative scope is intentionally `build.md` + `sources/`;
 * artifacts and the CAS (`.makedown/`) are derived, not synced.
 */
export async function readWorkspaceFromDisk(dir: string): Promise<WorkspaceSnapshot> {
  let buildMd = "";
  try {
    buildMd = normalizeEol(await readFile(join(dir, BUILD_FILE), "utf8"));
  } catch {
    buildMd = "";
  }
  const sources: Record<string, string> = {};
  for (const rel of await walk(dir, join(dir, SOURCES_DIR))) {
    sources[rel] = normalizeEol(await readFile(join(dir, rel), "utf8"));
  }
  return { buildMd, sources };
}

/**
 * Write a snapshot to the working tree, reconciling deletions: any file under
 * `sources/` not present in the snapshot is removed, so the tree matches the
 * snapshot exactly (and git status is accurate).
 */
export async function materializeToDisk(snapshot: WorkspaceSnapshot, dir: string): Promise<void> {
  await writeFile(join(dir, BUILD_FILE), snapshot.buildMd, "utf8");

  const wanted = new Set(Object.keys(snapshot.sources));
  for (const rel of await walk(dir, join(dir, SOURCES_DIR))) {
    if (!wanted.has(rel)) await rm(join(dir, rel), { force: true });
  }
  for (const [rel, content] of Object.entries(snapshot.sources)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}

/** Synchronous twin of {@link walk}. */
function walkSync(dir: string, root: string): string[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // missing dir -> no sources
  }
  const out: string[] = [];
  for (const entry of entries) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSync(dir, abs));
    } else if (entry.isFile()) {
      out.push(relative(dir, abs).split(sep).join("/"));
    }
  }
  return out;
}

/**
 * Synchronous twin of {@link readWorkspaceFromDisk}, for seeding/reconciling a
 * doc *before* it is exposed to any client (the open path must not yield).
 */
export function readWorkspaceFromDiskSync(dir: string): WorkspaceSnapshot {
  let buildMd = "";
  try {
    buildMd = normalizeEol(readFileSync(join(dir, BUILD_FILE), "utf8"));
  } catch {
    buildMd = "";
  }
  const sources: Record<string, string> = {};
  for (const rel of walkSync(dir, join(dir, SOURCES_DIR))) {
    sources[rel] = normalizeEol(readFileSync(join(dir, rel), "utf8"));
  }
  return { buildMd, sources };
}

/** Synchronous twin of {@link materializeToDisk}, for the room-teardown path. */
export function materializeToDiskSync(snapshot: WorkspaceSnapshot, dir: string): void {
  writeFileSync(join(dir, BUILD_FILE), snapshot.buildMd, "utf8");

  const wanted = new Set(Object.keys(snapshot.sources));
  for (const rel of walkSync(dir, join(dir, SOURCES_DIR))) {
    if (!wanted.has(rel)) rmSync(join(dir, rel), { force: true });
  }
  for (const [rel, content] of Object.entries(snapshot.sources)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

/** True if the working tree has staged-or-unstaged changes. */
async function hasChanges(dir: string): Promise<boolean> {
  const status = await git(dir, ["status", "--porcelain"]);
  return status.trim().length > 0;
}

/**
 * Commit the current working tree as a snapshot. Returns the new commit sha, or
 * `undefined` when there was nothing to commit (no empty snapshots).
 */
export async function commitSnapshot(
  dir: string,
  message: string,
  author: GitAuthor = DEFAULT_AUTHOR,
): Promise<string | undefined> {
  await git(dir, ["add", "-A"]);
  if (!(await hasChanges(dir))) return undefined;
  await git(dir, [
    "-c",
    `user.name=${author.name}`,
    "-c",
    `user.email=${author.email}`,
    "commit",
    "-m",
    message,
  ]);
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

const LOG_SEP = ""; // unit separator — safe inside commit messages
const LOG_FORMAT = ["%H", "%s", "%aI", "%an"].join(LOG_SEP);

/** List snapshots (commits), newest first. */
export async function listSnapshots(dir: string, limit = 100): Promise<Snapshot[]> {
  let out: string;
  try {
    out = await git(dir, ["log", `--max-count=${limit}`, `--format=${LOG_FORMAT}`]);
  } catch {
    return []; // no commits yet
  }
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, message, date, author] = line.split(LOG_SEP);
      return { sha: sha ?? "", message: message ?? "", date: date ?? "", author: author ?? "" };
    });
}

/** The current branch name. */
export async function currentBranch(dir: string): Promise<string> {
  return (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

/** All local branch names. */
export async function listBranches(dir: string): Promise<string[]> {
  const out = await git(dir, ["branch", "--format=%(refname:short)"]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export class InvalidBranchNameError extends Error {
  constructor(name: string) {
    super(`Invalid branch name: ${JSON.stringify(name)}`);
    this.name = "InvalidBranchNameError";
  }
}

/**
 * A safe, conservative subset of git ref names. Crucially rejects a leading `-`
 * (so the name can't be read as a git option) and `.`/path-like inputs (so
 * `git checkout <name>` can't be coerced into a pathspec checkout that discards
 * working-tree changes). Stricter than `git check-ref-format` on purpose.
 */
const BRANCH_NAME = /^(?![-./])(?!.*\.\.)(?!.*\/$)[A-Za-z0-9._\/-]+$/;

/** Validate an externally-supplied branch name, throwing on anything unsafe. */
export function assertValidBranchName(name: string): void {
  if (name.length === 0 || name.length > 255 || !BRANCH_NAME.test(name) || name.endsWith(".lock")) {
    throw new InvalidBranchNameError(name);
  }
}

/** Check out a branch, optionally creating it from the current HEAD. */
export async function checkoutBranch(
  dir: string,
  name: string,
  opts: { create?: boolean } = {},
): Promise<void> {
  assertValidBranchName(name);
  // No `--` separator here: `git checkout -- <name>` would force pathspec
  // (file-restore) semantics. Safety comes from assertValidBranchName, which
  // rejects a leading `-` so the name can never be read as an option.
  await git(dir, opts.create ? ["checkout", "-b", name] : ["checkout", name]);
}

/** Materialize the live doc to the working tree and commit it as a snapshot. */
export async function saveSnapshot(
  doc: Y.Doc,
  dir: string,
  message: string,
  opts: PersistenceOptions = {},
): Promise<string | undefined> {
  await materializeToDisk(loadSnapshot(doc), dir);
  return commitSnapshot(dir, message, opts.author);
}

/** Reconcile the live doc to the workspace's current on-disk content. */
export async function loadIntoDoc(doc: Y.Doc, dir: string): Promise<void> {
  applySnapshot(doc, await readWorkspaceFromDisk(dir));
}

/** Switch branches and reload the doc from that branch's content (§6 boundary). */
export async function switchBranch(doc: Y.Doc, dir: string, name: string): Promise<void> {
  await checkoutBranch(dir, name);
  await loadIntoDoc(doc, dir);
}

export interface WorkspacePersistenceOptions {
  /** Debounce window (ms) for coalescing rapid edits into one materialize. */
  readonly debounceMs?: number;
  /**
   * Hook invoked after each materialize (for tests / metrics). The default
   * implementation writes the snapshot to the working tree.
   */
  readonly onMaterialize?: (snapshot: WorkspaceSnapshot) => void | Promise<void>;
  readonly author?: GitAuthor;
}

const DEFAULT_DEBOUNCE_MS = 750;

/**
 * Observes a Y.Doc and debounce-materializes it to the working tree so the
 * engine always builds fresh text, without committing on every keystroke.
 * Snapshots (commits) remain explicit via {@link snapshot}.
 */
export class WorkspacePersistence {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private readonly debounceMs: number;
  private readonly onUpdate = (): void => this.schedule();

  constructor(
    private readonly doc: Y.Doc,
    private readonly dir: string,
    private readonly opts: WorkspacePersistenceOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.doc.on("update", this.onUpdate);
  }

  private schedule(): void {
    if (this.destroyed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** Materialize pending changes now (cancels any scheduled run). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.destroyed) return;
    const snapshot = loadSnapshot(this.doc);
    if (this.opts.onMaterialize) {
      // Full override (tests / custom sinks): no disk side-effects.
      await this.opts.onMaterialize(snapshot);
      return;
    }
    await materializeToDisk(snapshot, this.dir);
    // Persist the CRDT state too, so a reopened/restarted room restores the same
    // history instead of re-inserting text (which would duplicate on sync).
    await saveDocState(this.doc, this.dir);
  }

  /**
   * Materialize pending changes *synchronously* — for the room-teardown path
   * (last client left / shutdown). Persisting with blocking I/O leaves no async
   * window, so a dispose-then-immediate-reopen can never restore from a
   * half-written `build.md`/`ydoc.bin` pair (the reload-scramble bug). The
   * debounced editing path still uses the async {@link flush}.
   */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.destroyed) return;
    const snapshot = loadSnapshot(this.doc);
    if (this.opts.onMaterialize) {
      // Full override (tests / custom sinks): no disk side-effects.
      void this.opts.onMaterialize(snapshot);
      return;
    }
    materializeToDiskSync(snapshot, this.dir);
    saveDocStateSync(this.doc, this.dir);
  }

  /** Materialize and commit a named VCS snapshot. */
  async snapshot(message: string): Promise<string | undefined> {
    await this.flush();
    return commitSnapshot(this.dir, message, this.opts.author);
  }

  /** Detach from the doc and cancel any pending materialize. */
  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.doc.off("update", this.onUpdate);
  }
}
