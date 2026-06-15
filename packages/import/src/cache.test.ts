import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversionId, FileImportCache, importWithCache } from "./cache.js";
import type { Importer, ImportRequest, ImportResult } from "./importer.js";

/** A fake importer that counts how often it actually converts. */
class CountingImporter implements Importer {
  readonly id = "fake";
  calls = 0;
  constructor(private readonly out = "converted") {}
  async version(): Promise<string> {
    return "1.0.0";
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async convert(_req: ImportRequest): Promise<ImportResult> {
    this.calls += 1;
    return { markdown: this.out, producedBy: this.id };
  }
}

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("conversionId", () => {
  it("is stable for the same bytes + importer + version + hints", () => {
    const a = conversionId({ bytes: bytes("hello"), importerId: "markitdown", version: "0.1.6" });
    const b = conversionId({ bytes: bytes("hello"), importerId: "markitdown", version: "0.1.6" });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when the binary content changes", () => {
    const a = conversionId({ bytes: bytes("hello"), importerId: "markitdown", version: "0.1.6" });
    const b = conversionId({ bytes: bytes("HELLO"), importerId: "markitdown", version: "0.1.6" });
    expect(a).not.toBe(b);
  });

  it("changes when the importer version changes (so an upgrade re-imports)", () => {
    const a = conversionId({ bytes: bytes("x"), importerId: "markitdown", version: "0.1.6" });
    const b = conversionId({ bytes: bytes("x"), importerId: "markitdown", version: "0.2.0" });
    expect(a).not.toBe(b);
  });

  it("changes when a hint changes", () => {
    const a = conversionId({ bytes: bytes("x"), importerId: "m", version: "1", hints: { extensionHint: ".pdf" } });
    const b = conversionId({ bytes: bytes("x"), importerId: "m", version: "1", hints: { extensionHint: ".docx" } });
    expect(a).not.toBe(b);
  });
});

describe("FileImportCache", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "makedown-import-cache-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips markdown by id", async () => {
    const cache = new FileImportCache(dir);
    const id = "sha256:" + "a".repeat(64);
    expect(await cache.get(id)).toBeUndefined();
    await cache.set(id, "# stored");
    expect(await cache.get(id)).toBe("# stored");
  });

  it("writes under the cache dir, namespaced by id", async () => {
    const cache = new FileImportCache(dir);
    const id = "sha256:" + "b".repeat(64);
    await cache.set(id, "data");
    // The exact layout is internal, but the content must be retrievable and on disk.
    expect((await readFile(join(dir, "bb", "b".repeat(62) + ".md"), "utf8"))).toBe("data");
  });
});

describe("importWithCache", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "makedown-import-flow-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("converts on a cold cache and reuses on a warm one (no second conversion)", async () => {
    const importer = new CountingImporter("# out");
    const cache = new FileImportCache(dir);
    const input = { path: "/abs/report.pdf", bytes: bytes("PDFDATA") };

    const first = await importWithCache(importer, cache, input);
    expect(first.cached).toBe(false);
    expect(first.markdown).toBe("# out");
    expect(importer.calls).toBe(1);

    const second = await importWithCache(importer, cache, input);
    expect(second.cached).toBe(true);
    expect(second.markdown).toBe("# out");
    expect(second.id).toBe(first.id);
    expect(importer.calls).toBe(1); // not re-converted
  });

  it("re-converts when the binary bytes change", async () => {
    const importer = new CountingImporter("# out");
    const cache = new FileImportCache(dir);

    await importWithCache(importer, cache, { path: "/abs/x.pdf", bytes: bytes("V1") });
    await importWithCache(importer, cache, { path: "/abs/x.pdf", bytes: bytes("V2") });

    expect(importer.calls).toBe(2);
  });
});
