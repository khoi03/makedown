import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runSandboxedTransform,
  DEFAULT_TRANSFORM_TIMEOUT_MS,
  DEFAULT_TRANSFORM_MEMORY_MB,
} from "./transform-sandbox.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "makedown-xfsbx-"));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

async function script(name: string, body: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, body, "utf8");
  return p;
}

describe("runSandboxedTransform", () => {
  it("runs a normal transform and returns its string output", async () => {
    const p = await script(
      "ok.mjs",
      `export default (inputs) => inputs["a"].toUpperCase();`,
    );
    const out = await runSandboxedTransform({ scriptPath: p, inputs: { a: "hello" } });
    expect(out).toBe("HELLO");
  });

  it("supports a named `transform` export", async () => {
    const p = await script("named.mjs", `export function transform(i){ return "X:" + i.a; }`);
    expect(await runSandboxedTransform({ scriptPath: p, inputs: { a: "1" } })).toBe("X:1");
  });

  it("returns Uint8Array output as bytes", async () => {
    const p = await script(
      "bytes.mjs",
      `export default () => new Uint8Array([104, 105]);`,
    );
    const out = await runSandboxedTransform({ scriptPath: p, inputs: {} });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(out as Uint8Array).toString()).toBe("hi");
  });

  it("denies ambient filesystem access", async () => {
    const secret = join(dir, "secret.txt");
    await writeFile(secret, "TOP SECRET", "utf8");
    const p = await script(
      "leak.mjs",
      `import { readFileSync } from "node:fs";
       export default () => readFileSync(${JSON.stringify(secret)}, "utf8");`,
    );
    await expect(runSandboxedTransform({ scriptPath: p, inputs: {} })).rejects.toThrow(
      /access denied|ERR_ACCESS_DENIED|restricted|permission/i,
    );
  });

  it("kills a transform that exceeds the time cap", async () => {
    const p = await script("loop.mjs", `export default () => { while (true) {} };`);
    await expect(
      runSandboxedTransform({ scriptPath: p, inputs: {}, timeoutMs: 600 }),
    ).rejects.toThrow(/timed out|time cap|600/i);
  });

  it("kills a transform that exceeds the memory cap", async () => {
    const p = await script(
      "bomb.mjs",
      `export default () => { const a = []; for (;;) a.push(new Array(1e6).fill(7)); };`,
    );
    await expect(
      runSandboxedTransform({ scriptPath: p, inputs: {}, memoryMb: 64, timeoutMs: 15000 }),
    ).rejects.toThrow(/memory|crashed|exited/i);
  });

  it("isolates the result from the script's stdout noise", async () => {
    const p = await script(
      "noisy.mjs",
      `export default (i) => { console.log("noise line"); return "CLEAN:" + i.a; };`,
    );
    expect(await runSandboxedTransform({ scriptPath: p, inputs: { a: "z" } })).toBe("CLEAN:z");
  });

  it("rejects a script that does not export a function", async () => {
    const p = await script("notfn.mjs", `export const x = 42;`);
    await expect(runSandboxedTransform({ scriptPath: p, inputs: {} })).rejects.toThrow(
      /must export a function/i,
    );
  });

  it("propagates an error thrown inside the transform", async () => {
    const p = await script("throws.mjs", `export default () => { throw new Error("boom"); };`);
    await expect(runSandboxedTransform({ scriptPath: p, inputs: {} })).rejects.toThrow(/boom/);
  });

  it("does not expose the parent's secret environment to the script", async () => {
    process.env.MAKEDOWN_TEST_SECRET = "sk-do-not-leak";
    try {
      const p = await script(
        "env.mjs",
        `export default () => "SECRET=" + (process.env.MAKEDOWN_TEST_SECRET ?? "absent");`,
      );
      expect(await runSandboxedTransform({ scriptPath: p, inputs: {} })).toBe("SECRET=absent");
    } finally {
      delete process.env.MAKEDOWN_TEST_SECRET;
    }
  });

  it("exposes sensible default limits", () => {
    expect(DEFAULT_TRANSFORM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_TRANSFORM_MEMORY_MB).toBeGreaterThan(0);
  });
});
