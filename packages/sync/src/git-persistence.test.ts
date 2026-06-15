import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as Y from "yjs";
import { applySnapshot, getBuildText, loadSnapshot } from "./doc-model.js";
import {
  readWorkspaceFromDisk,
  readWorkspaceFromDiskSync,
  materializeToDisk,
  commitSnapshot,
  listSnapshots,
  currentBranch,
  checkoutBranch,
  assertValidBranchName,
  InvalidBranchNameError,
  saveSnapshot,
  loadIntoDoc,
  switchBranch,
  WorkspacePersistence,
} from "./git-persistence.js";

const exec = promisify(execFile);

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mdsync-"));
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@makedown.local"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

describe("git-backed persistence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await initRepo();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("materializes a snapshot to disk and reads it back", async () => {
    const snap = {
      buildMd: "## target: one\n```yaml\nstep: chat\n```\nHi.",
      sources: { "sources/a.md": "alpha", "sources/sub/b.md": "beta" },
    };
    await materializeToDisk(snap, dir);

    expect(await readFile(join(dir, "build.md"), "utf8")).toBe(snap.buildMd);
    expect(await readFile(join(dir, "sources/sub/b.md"), "utf8")).toBe("beta");
    expect(await readWorkspaceFromDisk(dir)).toEqual(snap);
  });

  it("reconciles disk deletions: a source removed from the snapshot is removed on disk", async () => {
    await materializeToDisk({ buildMd: "x", sources: { "sources/a.md": "a", "sources/b.md": "b" } }, dir);
    await materializeToDisk({ buildMd: "x", sources: { "sources/a.md": "a" } }, dir);

    const read = await readWorkspaceFromDisk(dir);
    expect(read.sources).toEqual({ "sources/a.md": "a" });
  });

  it("returns an empty source map when there is no sources dir", async () => {
    await writeFile(join(dir, "build.md"), "just a build file", "utf8");
    expect(await readWorkspaceFromDisk(dir)).toEqual({ buildMd: "just a build file", sources: {} });
  });

  it("normalizes CRLF/CR to LF on read (the Y.Text + CodeMirror are LF-only)", async () => {
    // Windows checkouts (core.autocrlf) leave \r\n in build.md. If that reaches
    // the Y.Text, CodeMirror — which normalizes to \n — ends up SHORTER than the
    // Y.Text, so y-codemirror writes edits at the wrong offset and scrambles the
    // doc. The disk-read boundary must strip \r so the collaborative text is LF.
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "build.md"), "## a\r\nmodel: x\r\nb", "utf8");
    await writeFile(join(dir, "sources", "s.md"), "line1\r\nline2\rline3", "utf8");

    for (const snap of [await readWorkspaceFromDisk(dir), readWorkspaceFromDiskSync(dir)]) {
      expect(snap.buildMd).toBe("## a\nmodel: x\nb");
      expect(snap.buildMd).not.toContain("\r");
      expect(snap.sources["sources/s.md"]).toBe("line1\nline2\nline3");
    }
  });

  it("commits a snapshot and lists it", async () => {
    await materializeToDisk({ buildMd: "v1", sources: {} }, dir);
    const sha = await commitSnapshot(dir, "first snapshot");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    const snaps = await listSnapshots(dir);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.message).toBe("first snapshot");
    expect(snaps[0]?.sha).toBe(sha);
  });

  it("round-trips a live doc through git: saveSnapshot -> loadIntoDoc", async () => {
    const a = new Y.Doc();
    applySnapshot(a, { buildMd: "## target: t\n```yaml\nstep: chat\n```\nbody", sources: { "sources/n.md": "note" } });
    await saveSnapshot(a, dir, "snap");

    const b = new Y.Doc();
    await loadIntoDoc(b, dir);
    expect(loadSnapshot(b)).toEqual(loadSnapshot(a));
  });

  it("isolates branches: switching reloads the doc from that branch's content", async () => {
    const doc = new Y.Doc();
    applySnapshot(doc, { buildMd: "main-content", sources: {} });
    await saveSnapshot(doc, dir, "on main");
    expect(await currentBranch(dir)).toBe("main");

    // create a feature branch and diverge
    await checkoutBranch(dir, "experiment", { create: true });
    getBuildText(doc).delete(0, getBuildText(doc).length);
    getBuildText(doc).insert(0, "experimental-content");
    await saveSnapshot(doc, dir, "on experiment");

    // back to main: doc must reflect main's content again
    await switchBranch(doc, dir, "main");
    expect(loadSnapshot(doc).buildMd).toBe("main-content");

    await switchBranch(doc, dir, "experiment");
    expect(loadSnapshot(doc).buildMd).toBe("experimental-content");
  });

  it("rejects unsafe branch names (argument injection) before touching git", async () => {
    for (const bad of ["-f", "--orphan", ".", "..", "a/../b", "name with space", "", "feature/"]) {
      await expect(checkoutBranch(dir, bad, { create: true })).rejects.toThrow(InvalidBranchNameError);
    }
    // A leading dash can never be passed to git as a flag.
    expect(() => assertValidBranchName("-D")).toThrow(InvalidBranchNameError);
    // Reasonable names pass.
    expect(() => assertValidBranchName("feature/new-graph")).not.toThrow();
    expect(() => assertValidBranchName("experiment_2")).not.toThrow();
  });

  it("does not commit when nothing changed (no empty snapshots)", async () => {
    await materializeToDisk({ buildMd: "v1", sources: {} }, dir);
    await commitSnapshot(dir, "first");
    const sha2 = await commitSnapshot(dir, "noop");
    expect(sha2).toBeUndefined();
    expect(await listSnapshots(dir)).toHaveLength(1);
  });
});

describe("WorkspacePersistence (debounced autosave to working tree)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await initRepo();
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it("coalesces rapid edits into a single debounced materialize", async () => {
    const doc = new Y.Doc();
    const writes: string[] = [];
    const persistence = new WorkspacePersistence(doc, dir, {
      debounceMs: 50,
      onMaterialize: (snap) => {
        writes.push(snap.buildMd);
      },
    });

    getBuildText(doc).insert(0, "a");
    getBuildText(doc).insert(1, "b");
    getBuildText(doc).insert(2, "c");
    expect(writes).toHaveLength(0); // nothing yet (debounced)

    await vi.advanceTimersByTimeAsync(60);
    expect(writes).toEqual(["abc"]); // one coalesced write

    persistence.destroy();
  });

  it("flush() materializes pending changes immediately", async () => {
    const doc = new Y.Doc();
    const persistence = new WorkspacePersistence(doc, dir, { debounceMs: 1000 });
    getBuildText(doc).insert(0, "hello");
    await persistence.flush();

    expect(await readFile(join(dir, "build.md"), "utf8")).toBe("hello");
    persistence.destroy();
  });

  it("stops materializing after destroy()", async () => {
    const doc = new Y.Doc();
    const writes: string[] = [];
    const persistence = new WorkspacePersistence(doc, dir, {
      debounceMs: 10,
      onMaterialize: (snap) => {
        writes.push(snap.buildMd);
      },
    });
    persistence.destroy();
    getBuildText(doc).insert(0, "ignored");
    await vi.advanceTimersByTimeAsync(50);
    expect(writes).toHaveLength(0);
  });
});
