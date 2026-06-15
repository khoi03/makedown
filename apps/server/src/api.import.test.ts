import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Importer, ImportRequest, ImportResult } from "@makedown/import";
import { ImporterError } from "@makedown/import";
import { WorkspaceStore } from "./workspace.js";
import { BuildManager } from "./builds.js";
import { buildApi } from "./api.js";

/** A fake importer: records conversions, returns canned markdown. */
class FakeImporter implements Importer {
  readonly id = "fake";
  calls: ImportRequest[] = [];
  constructor(private readonly markdown = "# Imported\n\nbody") {}
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

class MissingImporter implements Importer {
  readonly id = "fake";
  async version(): Promise<string> {
    throw new ImporterError("not_installed", "markitdown not found. Install with: pip install 'markitdown[all]'");
  }
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async convert(): Promise<ImportResult> {
    throw new ImporterError("not_installed", "markitdown not found. Install with: pip install 'markitdown[all]'");
  }
}

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

describe("POST /api/workspaces/:id/import", () => {
  let root: string;
  let app: FastifyInstance;
  let importer: FakeImporter;
  let added: Array<{ id: string; relPath: string; markdown: string }>;

  async function makeWorkspace(id: string): Promise<string> {
    const dir = join(root, id);
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "build.md"), "# ws\n", "utf8");
    return dir;
  }

  function makeApp(overrides: { importer?: Importer } = {}): FastifyInstance {
    added = [];
    return buildApi({
      store: new WorkspaceStore(root),
      manager: new BuildManager(),
      importer: overrides.importer ?? importer,
      addSourceToWorkspace: (id, relPath, markdown) => {
        added.push({ id, relPath, markdown });
      },
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdimport-"));
    importer = new FakeImporter("# Report\n\nhello");
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("converts an uploaded file → a Markdown source on disk and reflects it into the live doc", async () => {
    await makeWorkspace("w1");
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/w1/import",
      payload: { fileName: "report.pdf", contentBase64: b64("%PDF fake") },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.path).toBe("sources/report.md");
    expect(body.cached).toBe(false);
    expect(await readFile(join(root, "w1", "sources", "report.md"), "utf8")).toBe("# Report\n\nhello");
    expect(added).toEqual([{ id: "w1", relPath: "sources/report.md", markdown: "# Report\n\nhello" }]);
    // The importer received the extension hint derived from the file name.
    expect(importer.calls[0]?.extensionHint).toBe(".pdf");
  });

  it("serves an identical re-upload from cache without re-converting", async () => {
    await makeWorkspace("w1");
    const payload = { fileName: "report.pdf", contentBase64: b64("same") };
    await app.inject({ method: "POST", url: "/api/workspaces/w1/import", payload });
    const res2 = await app.inject({ method: "POST", url: "/api/workspaces/w1/import", payload });

    expect(res2.json().cached).toBe(true);
    expect(importer.calls).toHaveLength(1);
  });

  it("honors a custom out path inside the workspace", async () => {
    await makeWorkspace("w1");
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/w1/import",
      payload: { fileName: "data.xlsx", contentBase64: b64("x"), out: "sources/sub/data.md" },
    });
    expect(res.statusCode).toBe(201);
    expect(await readFile(join(root, "w1", "sources", "sub", "data.md"), "utf8")).toBe("# Report\n\nhello");
  });

  it("rejects a request missing fileName or contentBase64 (400)", async () => {
    await makeWorkspace("w1");
    const res = await app.inject({ method: "POST", url: "/api/workspaces/w1/import", payload: { fileName: "x.pdf" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an out path that escapes the workspace (400)", async () => {
    await makeWorkspace("w1");
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/w1/import",
      payload: { fileName: "x.pdf", contentBase64: b64("x"), out: "../escape.md" },
    });
    expect(res.statusCode).toBe(400);
    expect(added).toEqual([]);
  });

  it("rejects an oversized upload (413)", async () => {
    await makeWorkspace("w1");
    app = buildApi({
      store: new WorkspaceStore(root),
      manager: new BuildManager(),
      importer,
      maxImportBytes: 4,
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/w1/import",
      payload: { fileName: "x.pdf", contentBase64: b64("this is longer than four bytes") },
    });
    expect(res.statusCode).toBe(413);
  });

  it("returns 503 with an install hint when markitdown is not installed", async () => {
    await makeWorkspace("w1");
    app = makeApp({ importer: new MissingImporter() });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/w1/import",
      payload: { fileName: "x.pdf", contentBase64: b64("x") },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/pip install/i);
  });
});
