/**
 * Sandbox provisioning for steps that execute code/agents. An agent step runs in
 * an isolated working directory so it cannot touch the real workspace; the engine
 * provisions the sandbox per the target's `sandbox` policy and tears it down after.
 *
 * - `worktree` — a detached `git worktree` off the workspace's HEAD: a real,
 *   throwaway checkout the agent can edit freely. Requires a git repo.
 * - `none` — run in the workspace itself (advisory; trusted `build.md` only).
 * - `container` — not implemented yet (SPEC §6, §11).
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Sandbox as SandboxPolicy } from "@makedown/shared";
import { NotImplementedError } from "./build.js";

const execFileAsync = promisify(execFile);

/** A provisioned sandbox: a working directory plus diff + teardown hooks. */
export interface SandboxHandle {
  /** Absolute path the step should operate in. */
  readonly dir: string;
  /**
   * Unified diff of everything changed in the sandbox since it was provisioned
   * (new files included), or `undefined` if this sandbox can't compute one (e.g.
   * `none`, which has no isolated baseline). An empty string means "no changes".
   */
  diff(): Promise<string | undefined>;
  /** Remove the sandbox. Safe to call once; never throws on a best-effort cleanup. */
  cleanup(): Promise<void>;
}

/** Cap on the captured diff so a runaway agent can't exhaust memory. */
const MAX_DIFF_BYTES = 64 * 1024 * 1024;

/** Provision an isolated working directory for a step per its sandbox policy. */
export async function provisionSandbox(
  workspaceDir: string,
  policy: SandboxPolicy,
): Promise<SandboxHandle> {
  switch (policy) {
    case "none":
      return { dir: workspaceDir, diff: async () => undefined, cleanup: async () => {} };
    case "worktree":
      return provisionWorktree(workspaceDir);
    case "container":
      throw new NotImplementedError(
        "sandbox: container is not implemented yet (use worktree or none)",
      );
  }
}

async function provisionWorktree(workspaceDir: string): Promise<SandboxHandle> {
  const parent = await mkdtemp(join(tmpdir(), "makedown-agent-"));
  const dir = join(parent, "worktree");
  try {
    await execFileAsync("git", ["-C", workspaceDir, "worktree", "add", "--detach", dir, "HEAD"]);
  } catch (err) {
    await rm(parent, { recursive: true, force: true });
    throw new Error(
      `sandbox: worktree requires the workspace to be a git repository with at least one commit ` +
        `(${(err as Error).message.trim()})`,
    );
  }
  return {
    dir,
    async diff() {
      // Stage everything (so new files appear) then emit a unified diff against HEAD.
      await execFileAsync("git", ["-C", dir, "add", "-A"]).catch(() => {});
      const { stdout } = await execFileAsync("git", ["-C", dir, "diff", "--cached"], {
        maxBuffer: MAX_DIFF_BYTES,
      });
      return stdout;
    },
    async cleanup() {
      // Best-effort: detach the worktree from git's registry, then delete the
      // files. Never throw — cleanup failures (e.g. a locked file on Windows)
      // must not fail a build whose agent step already succeeded.
      await execFileAsync("git", [
        "-C",
        workspaceDir,
        "worktree",
        "remove",
        "--force",
        dir,
      ]).catch(() => {});
      await rm(parent, { recursive: true, force: true }).catch(() => {});
    },
  };
}
