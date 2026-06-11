import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { provisionSandbox } from "./sandbox.js";
import { NotImplementedError } from "./build.js";
import { makeWorkspace, type Workspace } from "./_testkit.js";

const run = promisify(execFile);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Turn the throwaway workspace into a git repo with one commit (HEAD exists). */
async function initGitRepo(dir: string): Promise<void> {
  await run("git", ["-C", dir, "init", "-q"]);
  await run("git", ["-C", dir, "config", "user.email", "test@makedown.dev"]);
  await run("git", ["-C", dir, "config", "user.name", "Makedown Test"]);
  await writeFile(join(dir, "seed.txt"), "seed", "utf8");
  await run("git", ["-C", dir, "add", "."]);
  await run("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
}

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(() => ws.cleanup());

describe("provisionSandbox", () => {
  it("sandbox: none runs in the workspace directory itself", async () => {
    const sandbox = await provisionSandbox(ws.dir, "none");
    expect(sandbox.dir).toBe(ws.dir);
    await sandbox.cleanup(); // no-op, must not throw
  });

  it("sandbox: container is not implemented yet", async () => {
    await expect(provisionSandbox(ws.dir, "container")).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("sandbox: worktree provisions an isolated git worktree and tears it down", async () => {
    await initGitRepo(ws.dir);

    const sandbox = await provisionSandbox(ws.dir, "worktree");
    expect(sandbox.dir).not.toBe(ws.dir);
    expect(await exists(sandbox.dir)).toBe(true);
    // The worktree is a checkout of HEAD, so the committed file is present.
    expect(await readFile(join(sandbox.dir, "seed.txt"), "utf8")).toBe("seed");

    await sandbox.cleanup();
    expect(await exists(sandbox.dir)).toBe(false);
  });

  it("sandbox: worktree fails clearly when the workspace is not a git repo", async () => {
    await expect(provisionSandbox(ws.dir, "worktree")).rejects.toThrow(/git rep(osit)?/i);
  });

  it("worktree diff() reports files created/changed inside the sandbox", async () => {
    await initGitRepo(ws.dir);
    const sandbox = await provisionSandbox(ws.dir, "worktree");

    await writeFile(join(sandbox.dir, "greet.js"), "function greet(n){ return n; }\n", "utf8");
    const diff = await sandbox.diff();

    expect(diff).toContain("greet.js");
    expect(diff).toContain("+function greet");
    await sandbox.cleanup();
  });

  it("worktree diff() is empty when the sandbox is untouched", async () => {
    await initGitRepo(ws.dir);
    const sandbox = await provisionSandbox(ws.dir, "worktree");
    expect((await sandbox.diff())?.trim()).toBe("");
    await sandbox.cleanup();
  });

  it("none diff() returns undefined (no isolated checkout to diff)", async () => {
    const sandbox = await provisionSandbox(ws.dir, "none");
    expect(await sandbox.diff()).toBeUndefined();
    await sandbox.cleanup();
  });
});
