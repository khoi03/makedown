import { describe, it, expect } from "vitest";
import { execPath } from "node:process";
import { defaultConvertExec } from "./importer.js";

const OPTS = { timeoutMs: 5_000, maxOutputBytes: 1024 * 1024 };

describe("defaultConvertExec (real subprocess)", () => {
  it("captures stdout from a command that exits cleanly", async () => {
    const res = await defaultConvertExec(
      execPath,
      ["-e", "process.stdout.write('# hi')"],
      OPTS,
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("# hi");
    expect(res.timedOut).toBe(false);
  });

  it("captures a non-zero exit code and stderr", async () => {
    const res = await defaultConvertExec(
      execPath,
      ["-e", "process.stderr.write('boom'); process.exit(3)"],
      OPTS,
    );
    expect(res.code).toBe(3);
    expect(res.stderr).toContain("boom");
  });

  it("kills and flags a command that overruns the time cap", async () => {
    const res = await defaultConvertExec(
      execPath,
      ["-e", "setTimeout(() => {}, 60000)"],
      { timeoutMs: 150, maxOutputBytes: 1024 },
    );
    expect(res.timedOut).toBe(true);
  });

  it("kills and flags a command that overruns the output-size cap", async () => {
    const res = await defaultConvertExec(
      execPath,
      ["-e", "setInterval(() => process.stdout.write('x'.repeat(10000)), 1)"],
      { timeoutMs: 5_000, maxOutputBytes: 5000 },
    );
    expect(res.tooLarge).toBe(true);
  });

  it("rejects with ENOENT when the executable does not exist", async () => {
    await expect(
      defaultConvertExec("definitely-not-a-real-binary-xyz", [], OPTS),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runs an executable whose path contains spaces (not tokenized)", async () => {
    // execPath on Windows is typically "C:\Program Files\nodejs\node.exe".
    const res = await defaultConvertExec(execPath, ["-e", "process.stdout.write('ok')"], OPTS);
    expect(res.stdout).toBe("ok");
  });
});
