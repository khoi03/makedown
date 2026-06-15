import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Importer, ImportRequest, ImportResult } from "@makedown/import";
import { ImporterError } from "@makedown/import";
import { cmdImport } from "./commands.js";

/** A fake importer that records conversions and returns canned markdown. */
class FakeImporter implements Importer {
  readonly id = "fake";
  calls: ImportRequest[] = [];
  constructor(private readonly markdown = "# Converted\n\nbody") {}
  async version(): Promise<string> {
    return "1.0.0";
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async convert(request: ImportRequest): Promise<ImportResult> {
    this.calls.push(request);
    return { markdown: this.markdown, producedBy: this.id };
  }
}

/** An importer that always reports the tool isn't installed. */
class MissingImporter implements Importer {
  readonly id = "fake";
  async version(): Promise<string> {
    throw new ImporterError("not_installed", "not found. Install it with: pip install 'markitdown[all]'");
  }
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async convert(): Promise<ImportResult> {
    throw new ImporterError("not_installed", "not found. Install it with: pip install 'markitdown[all]'");
  }
}

let dir: string;
let logs: string[];
let errors: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "makedown-import-cli-"));
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
  process.exitCode = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await rm(dir, { recursive: true, force: true });
});

describe("cmdImport", () => {
  it("converts a source file and writes Markdown to the default sources/ path", async () => {
    const src = join(dir, "report.pdf");
    await writeFile(src, "%PDF-1.4 fake bytes", "utf8");
    const importer = new FakeImporter("# Report\n\nhello");

    await cmdImport(src, { dir, importer });

    const out = await readFile(join(dir, "sources", "report.md"), "utf8");
    expect(out).toBe("# Report\n\nhello");
    expect(logs.join("\n")).toMatch(/report\.md/);
    expect(process.exitCode).toBe(0);
  });

  it("passes an extension hint derived from the source file", async () => {
    const src = join(dir, "deck.pptx");
    await writeFile(src, "fake", "utf8");
    const importer = new FakeImporter();

    await cmdImport(src, { dir, importer });

    expect(importer.calls[0]?.extensionHint).toBe(".pptx");
    expect(importer.calls[0]?.path).toBe(src);
  });

  it("honors a custom -o output path inside the workspace", async () => {
    const src = join(dir, "data.xlsx");
    await writeFile(src, "fake", "utf8");

    await cmdImport(src, { dir, out: "sources/imported/data.md", importer: new FakeImporter("# X") });

    expect(await readFile(join(dir, "sources", "imported", "data.md"), "utf8")).toBe("# X");
  });

  it("serves a second identical import from cache without re-converting", async () => {
    const src = join(dir, "report.pdf");
    await writeFile(src, "same bytes", "utf8");
    const importer = new FakeImporter("# Same");

    await cmdImport(src, { dir, importer });
    await cmdImport(src, { dir, importer });

    expect(importer.calls).toHaveLength(1);
    expect(logs.join("\n")).toMatch(/cache/i);
  });

  it("errors with a non-zero exit when the source file is missing", async () => {
    await cmdImport(join(dir, "nope.pdf"), { dir, importer: new FakeImporter() });
    expect(errors.join("\n")).toMatch(/not found|no such file|cannot read/i);
    expect(process.exitCode).toBe(1);
  });

  it("gives an actionable install hint when markitdown is not installed", async () => {
    const src = join(dir, "x.pdf");
    await writeFile(src, "fake", "utf8");

    await cmdImport(src, { dir, importer: new MissingImporter() });

    expect(errors.join("\n")).toMatch(/pip install/i);
    expect(process.exitCode).toBe(1);
  });

  it("refuses an output path that escapes the workspace", async () => {
    const src = join(dir, "x.pdf");
    await writeFile(src, "fake", "utf8");

    await cmdImport(src, { dir, out: "../escape.md", importer: new FakeImporter() });

    expect(errors.join("\n")).toMatch(/workspace/i);
    expect(process.exitCode).toBe(1);
  });
});
