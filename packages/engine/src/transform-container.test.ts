import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runContainerTransform,
  isDockerAvailable,
  DEFAULT_TRANSFORM_CONTAINER_IMAGE,
} from "./transform-container.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "makedown-xfc-test-"));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

async function script(name: string, body: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, body, "utf8");
  return p;
}

// Gate daemon-dependent tests on a *local* probe (no network pull): Docker must
// be reachable and the image already present. Pre-pull the image to enable them.
const dockerReady = await isDockerAvailable(DEFAULT_TRANSFORM_CONTAINER_IMAGE);

describe("runContainerTransform", () => {
  it("isDockerAvailable resolves to a boolean", async () => {
    expect(typeof (await isDockerAvailable())).toBe("boolean");
  });

  it("reports an actionable error when the docker CLI is not found", async () => {
    const p = await script("ok.mjs", `export default () => "x";`);
    await expect(
      runContainerTransform({ scriptPath: p, inputs: {}, dockerPath: "makedown-no-such-docker" }),
    ).rejects.toThrow(/docker/i);
  });

  it("the docker-not-found error suggests an alternative", async () => {
    const p = await script("ok.mjs", `export default () => "x";`);
    await expect(
      runContainerTransform({ scriptPath: p, inputs: {}, dockerPath: "makedown-no-such-docker" }),
    ).rejects.toThrow(/install|worktree|not found/i);
  });

  // Container cold-starts are slow; give the daemon-gated tests room.
  const CONTAINER_TEST_TIMEOUT = 60_000;

  it.skipIf(!dockerReady)(
    "runs a transform inside a container and returns its output",
    async () => {
      const p = await script("up.mjs", `export default (i) => i.a.toUpperCase();`);
      const out = await runContainerTransform({ scriptPath: p, inputs: { a: "hello" } });
      expect(out).toBe("HELLO");
    },
    CONTAINER_TEST_TIMEOUT,
  );

  it.skipIf(!dockerReady)(
    "blocks network access (--network none)",
    async () => {
      const p = await script(
        "net.mjs",
        `export default async () => { await fetch("http://example.com"); return "REACHED"; };`,
      );
      await expect(
        runContainerTransform({ scriptPath: p, inputs: {}, timeoutMs: 30000 }),
      ).rejects.toThrow(/fetch|network|ENOTFOUND|EAI_AGAIN|denied|failed/i);
    },
    CONTAINER_TEST_TIMEOUT,
  );

  it.skipIf(!dockerReady)(
    "isolates the result from the script's stdout noise",
    async () => {
      const p = await script(
        "noisy.mjs",
        `export default (i) => { console.log("container noise"); return "CLEAN:" + i.a; };`,
      );
      expect(await runContainerTransform({ scriptPath: p, inputs: { a: "z" } })).toBe("CLEAN:z");
    },
    CONTAINER_TEST_TIMEOUT,
  );

  it.skipIf(!dockerReady)(
    "rejects a script that does not export a function",
    async () => {
      const p = await script("notfn.mjs", `export const x = 1;`);
      await expect(runContainerTransform({ scriptPath: p, inputs: {} })).rejects.toThrow(
        /must export a function/i,
      );
    },
    CONTAINER_TEST_TIMEOUT,
  );
});
