import { describe, it, expect } from "vitest";
import { MarkItDownImporter } from "./markitdown.js";
import { ImporterError, type ConvertExec, type ConvertExecResult } from "./importer.js";

/** Build a fake exec that records its invocation and returns a canned result. */
function fakeExec(
  result: Partial<ConvertExecResult>,
): { exec: ConvertExec; calls: Array<{ command: string; args: readonly string[] }> } {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const exec: ConvertExec = async (command, args) => {
    calls.push({ command, args });
    return { stdout: "", stderr: "", code: 0, signal: null, timedOut: false, ...result };
  };
  return { exec, calls };
}

/** A fake exec that rejects (e.g. the binary is missing → ENOENT). */
function throwingExec(err: Error): ConvertExec {
  return async () => {
    throw err;
  };
}

describe("MarkItDownImporter.convert", () => {
  it("returns the CLI's stdout as the converted markdown", async () => {
    const { exec } = fakeExec({ stdout: "# Title\n\nbody", code: 0 });
    const importer = new MarkItDownImporter({ exec });

    const res = await importer.convert({ path: "/abs/report.pdf" });

    expect(res.markdown).toBe("# Title\n\nbody");
    expect(res.producedBy).toBe("markitdown");
  });

  it("passes the file path and an extension hint as argv (no shell string)", async () => {
    const { exec, calls } = fakeExec({ stdout: "ok" });
    const importer = new MarkItDownImporter({ exec });

    await importer.convert({ path: "/abs/report.pdf", extensionHint: ".pdf" });

    expect(calls[0]?.command).toBe("markitdown");
    expect(calls[0]?.args).toEqual(["/abs/report.pdf", "-x", ".pdf"]);
  });

  it("forwards mime and charset hints when provided", async () => {
    const { exec, calls } = fakeExec({ stdout: "ok" });
    const importer = new MarkItDownImporter({ exec });

    await importer.convert({
      path: "/abs/data",
      mimeHint: "application/pdf",
      charsetHint: "utf-8",
    });

    expect(calls[0]?.args).toEqual(["/abs/data", "-m", "application/pdf", "-c", "utf-8"]);
  });

  it("honors a single-string custom command (path with spaces, not tokenized)", async () => {
    const { exec, calls } = fakeExec({ stdout: "ok" });
    const spaced = "C:\\Program Files\\md\\markitdown.exe";
    const importer = new MarkItDownImporter({ exec, command: spaced });
    await importer.convert({ path: "/abs/x.docx" });
    expect(calls[0]?.command).toBe(spaced);
    expect(calls[0]?.args).toEqual(["/abs/x.docx"]);
  });

  it("honors an array command (executable + leading args), e.g. python -m markitdown", async () => {
    const { exec, calls } = fakeExec({ stdout: "ok" });
    const importer = new MarkItDownImporter({ exec, command: ["python", "-m", "markitdown"] });
    await importer.convert({ path: "/abs/x.docx", extensionHint: ".docx" });
    expect(calls[0]?.command).toBe("python");
    expect(calls[0]?.args).toEqual(["-m", "markitdown", "/abs/x.docx", "-x", ".docx"]);
  });

  it("translates a missing binary (ENOENT) into an actionable not_installed error", async () => {
    const err = Object.assign(new Error("spawn markitdown ENOENT"), { code: "ENOENT" });
    const importer = new MarkItDownImporter({ exec: throwingExec(err) });

    await expect(importer.convert({ path: "/abs/x.pdf" })).rejects.toMatchObject({
      name: "ImporterError",
      kind: "not_installed",
    });
    await expect(importer.convert({ path: "/abs/x.pdf" })).rejects.toThrow(/pip install/i);
  });

  it("reports a timeout distinctly", async () => {
    const { exec } = fakeExec({ timedOut: true, signal: "SIGKILL", code: null });
    const importer = new MarkItDownImporter({ exec });

    await expect(importer.convert({ path: "/abs/big.pdf" })).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("surfaces a non-zero exit as conversion_failed with the stderr tail", async () => {
    const { exec } = fakeExec({ code: 1, stderr: "FileConversionException: unsupported" });
    const importer = new MarkItDownImporter({ exec });

    const err = await importer.convert({ path: "/abs/x.zzz" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImporterError);
    expect((err as ImporterError).kind).toBe("conversion_failed");
    expect((err as ImporterError).message).toContain("unsupported");
  });

  it("rejects an empty conversion (no stdout, exit 0) rather than writing a blank artifact", async () => {
    const { exec } = fakeExec({ stdout: "", code: 0 });
    const importer = new MarkItDownImporter({ exec });
    await expect(importer.convert({ path: "/abs/blank.pdf" })).rejects.toMatchObject({
      kind: "conversion_failed",
    });
  });
});

describe("MarkItDownImporter.version", () => {
  it("parses the CLI --version output", async () => {
    const { exec, calls } = fakeExec({ stdout: "markitdown 0.1.6\n", code: 0 });
    const importer = new MarkItDownImporter({ exec });

    const version = await importer.version();

    expect(version).toBe("0.1.6");
    expect(calls[0]?.args).toEqual(["--version"]);
  });

  it("falls back to a stable sentinel when the version can't be parsed", async () => {
    const { exec } = fakeExec({ stdout: "weird", code: 0 });
    const importer = new MarkItDownImporter({ exec });
    expect(await importer.version()).toBe("unknown");
  });

  it("reports not_installed when the version probe can't spawn", async () => {
    const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    const importer = new MarkItDownImporter({ exec: throwingExec(err) });
    await expect(importer.version()).rejects.toMatchObject({ kind: "not_installed" });
  });

  it("isAvailable resolves false instead of throwing when the tool is missing", async () => {
    const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    const importer = new MarkItDownImporter({ exec: throwingExec(err) });
    expect(await importer.isAvailable()).toBe(false);
  });

  it("isAvailable resolves true when the version probe succeeds", async () => {
    const { exec } = fakeExec({ stdout: "markitdown 0.1.6", code: 0 });
    const importer = new MarkItDownImporter({ exec });
    expect(await importer.isAvailable()).toBe(true);
  });
});
