import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import type { CompletionRequest, CompletionResult, Provider } from "@makedown/providers";
import {
  conversionId,
  ImporterError,
  type Importer,
  type ImportCacheStore,
  type ImportResult,
  type ImportRequest,
} from "@makedown/import";
import { LocalCas } from "./cas.js";
import { planBuild, runBuild, type BuildContext } from "./build.js";
import { PathEscapeError } from "./paths.js";

/** Records what the model was sent. */
class FakeProvider implements Provider {
  readonly id = "fake";
  readonly calls: CompletionRequest[] = [];
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    return { text: `OUT(${req.prompt})`, usage: { input: 1, output: 2 }, costUsd: 0.01 };
  }
}

/** A fake any-file → Markdown importer: counts conversions, returns canned Markdown. */
class FakeImporter implements Importer {
  readonly id = "fake-importer";
  convertCount = 0;
  readonly requests: ImportRequest[] = [];
  constructor(
    private readonly markdown = "# Converted\n\nfrom the binary",
    private readonly ver = "1.0",
  ) {}
  async version(): Promise<string> {
    return this.ver;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async convert(request: ImportRequest): Promise<ImportResult> {
    this.convertCount++;
    this.requests.push(request);
    return { markdown: this.markdown, producedBy: this.id };
  }
}

/** An importer whose tool is absent: version()/convert() report not_installed. */
class MissingImporter implements Importer {
  readonly id = "missing";
  async version(): Promise<string> {
    throw new ImporterError("not_installed", "markitdown is not installed");
  }
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async convert(): Promise<ImportResult> {
    throw new ImporterError("not_installed", "markitdown is not installed");
  }
}

class MemCache implements ImportCacheStore {
  readonly store = new Map<string, string>();
  async get(id: string): Promise<string | undefined> {
    return this.store.get(id);
  }
  async set(id: string, markdown: string): Promise<void> {
    this.store.set(id, markdown);
  }
}

let dir: string;
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "makedown-import-"));
  await mkdir(join(dir, "sources"), { recursive: true });
  await writeFile(join(dir, "sources", "report.pdf"), PDF_BYTES);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ctx(opts: {
  provider?: Provider;
  importer?: Importer;
  importCache?: ImportCacheStore;
} = {}): BuildContext {
  return {
    workspaceDir: dir,
    cas: new LocalCas(join(dir, ".makedown")),
    provider: opts.provider,
    importer: opts.importer,
    importCache: opts.importCache,
    now: () => new Date("2026-06-16T00:00:00.000Z"),
  };
}

const PDF_CHAT = `## target: brief
\`\`\`yaml
inputs: [sources/report.pdf]
step: chat
model: claude-opus-4-8
cache: deterministic
\`\`\`
Summarize {{sources/report.pdf}}.
`;

describe("in-graph auto-import — hashing", () => {
  it("hashes an importable input by its conversionId (bytes + importer + version + hint)", async () => {
    const importer = new FakeImporter();
    const plan = await planBuild(parseBuildDoc(PDF_CHAT), ctx({ importer, importCache: new MemCache() }));

    const input = plan.targets[0]!.inputs[0]!;
    const expected = conversionId({
      bytes: PDF_BYTES,
      importerId: importer.id,
      version: "1.0",
      hints: { extensionHint: ".pdf" },
    });
    expect(input.hash).toBe(expected);
    expect(input.kind).toBe("source");
  });

  it("re-stales the target when the binary bytes change", async () => {
    const doc = parseBuildDoc(PDF_CHAT);
    await runBuild(doc, ctx({ provider: new FakeProvider(), importer: new FakeImporter(), importCache: new MemCache() }));

    await writeFile(join(dir, "sources", "report.pdf"), new Uint8Array([1, 2, 3, 4]));
    const plan = await planBuild(doc, ctx({ importer: new FakeImporter(), importCache: new MemCache() }));
    expect(plan.targets[0]!.stale).toBe(true);
  });

  it("re-stales the target when the importer version bumps (output may differ)", async () => {
    const doc = parseBuildDoc(PDF_CHAT);
    const cache = new MemCache();
    await runBuild(doc, ctx({ provider: new FakeProvider(), importer: new FakeImporter("# v1", "1.0"), importCache: cache }));

    // Same bytes, newer importer → different conversionId → stale.
    const plan = await planBuild(doc, ctx({ importer: new FakeImporter("# v2", "2.0"), importCache: cache }));
    expect(plan.targets[0]!.stale).toBe(true);
  });

  it("records import provenance on the resolved input", async () => {
    const importer = new FakeImporter();
    const plan = await planBuild(parseBuildDoc(PDF_CHAT), ctx({ importer, importCache: new MemCache() }));
    const input = plan.targets[0]!.inputs[0]!;
    expect(input.imported?.importer).toBe("fake-importer");
    expect(input.imported?.conversionId).toBe(input.hash);
  });
});

describe("in-graph auto-import — content", () => {
  it("feeds the converted Markdown (not raw bytes) into the prompt", async () => {
    const provider = new FakeProvider();
    await runBuild(
      parseBuildDoc(PDF_CHAT),
      ctx({ provider, importer: new FakeImporter("# Q3 report\n\nrevenue up"), importCache: new MemCache() }),
    );
    expect(provider.calls[0]!.prompt).toBe("Summarize # Q3 report\n\nrevenue up.");
  });

  it("converts once and reuses the cache on a second build", async () => {
    const doc = parseBuildDoc(PDF_CHAT);
    const importer = new FakeImporter();
    const cache = new MemCache();
    await runBuild(doc, ctx({ provider: new FakeProvider(), importer, importCache: cache }));
    expect(importer.convertCount).toBe(1);

    // Second build: same bytes → cache hit → no reconversion.
    await runBuild(doc, ctx({ provider: new FakeProvider(), importer, importCache: cache }));
    expect(importer.convertCount).toBe(1);
  });

  it("passes the extension hint derived from the ref to the importer", async () => {
    const importer = new FakeImporter();
    await runBuild(parseBuildDoc(PDF_CHAT), ctx({ provider: new FakeProvider(), importer, importCache: new MemCache() }));
    expect(importer.requests[0]!.extensionHint).toBe(".pdf");
  });
});

describe("in-graph auto-import — confinement & regressions", () => {
  it("confines an importable input to the workspace (rejects ..\\ escape)", async () => {
    const doc = parseBuildDoc(
      `## target: t\n\`\`\`yaml\ninputs: [../escape.pdf]\nstep: chat\nmodel: claude-opus-4-8\n\`\`\`\nUse {{../escape.pdf}}\n`,
    );
    await expect(
      planBuild(doc, ctx({ importer: new FakeImporter(), importCache: new MemCache() })),
    ).rejects.toBeInstanceOf(PathEscapeError);
  });

  it("leaves native text inputs (.csv) untouched — raw content hash, raw text", async () => {
    await writeFile(join(dir, "sources", "prices.csv"), "day,price\n1,10\n", "utf8");
    const doc = parseBuildDoc(
      `## target: t\n\`\`\`yaml\ninputs: [sources/prices.csv]\nstep: chat\nmodel: claude-opus-4-8\n\`\`\`\nData: {{sources/prices.csv}}\n`,
    );
    const importer = new FakeImporter();
    const provider = new FakeProvider();
    await runBuild(doc, ctx({ provider, importer, importCache: new MemCache() }));

    // The importer was never invoked for a native text file.
    expect(importer.convertCount).toBe(0);
    expect(provider.calls[0]!.prompt).toBe("Data: day,price\n1,10\n");
  });
});

describe("in-graph auto-import — degraded (no/absent importer)", () => {
  it("plan-only falls back to a raw-bytes hash when no importer is configured", async () => {
    const plan = await planBuild(parseBuildDoc(PDF_CHAT), ctx({}));
    // Still content-addressed (stable), just not the conversionId; no import provenance.
    expect(plan.targets[0]!.inputs[0]!.hash).toMatch(/^sha256:/);
    expect(plan.targets[0]!.inputs[0]!.imported).toBeUndefined();
  });

  it("plan-only tolerates an absent tool (version() throws) with a raw-bytes hash", async () => {
    const plan = await planBuild(parseBuildDoc(PDF_CHAT), ctx({ importer: new MissingImporter(), importCache: new MemCache() }));
    expect(plan.targets[0]!.inputs[0]!.hash).toMatch(/^sha256:/);
  });

  it("a real build of an importable input with no importer fails with a clear error", async () => {
    await expect(
      runBuild(parseBuildDoc(PDF_CHAT), ctx({ provider: new FakeProvider() })),
    ).rejects.toThrow(/import/i);
  });
});
