/**
 * Source-import endpoint: the web counterpart to the CLI's `md import`. A client
 * uploads a non-Markdown file (PDF/DOCX/PPTX/XLSX/HTML/…) as base64; the server
 * converts it via the shared `MarkItDownImporter` (+ content-addressed cache),
 * writes the result as a `sources/*.md` file confined to the workspace, and
 * reflects it into the live Y.Doc so connected editors see it immediately.
 *
 * The conversion runs MarkItDown as a subprocess with the server's privileges,
 * so in a multi-tenant deployment the uploaded file is attacker-controlled input
 * to that parser — the importer's own timeout + output cap bound it, and the
 * upload itself is size-capped here. Single-tenant self-hosts carry the same
 * trust as running `md import` locally.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveInWorkspace, PathEscapeError } from "@makedown/engine";
import { FileImportCache, importWithCache, ImporterError, type Importer } from "@makedown/import";
import type { WorkspaceStore } from "./workspace.js";
import type { Action } from "./tenancy/index.js";

/** Max decoded upload size. base64 in the JSON body is ~33% larger than this. */
export const DEFAULT_MAX_IMPORT_BYTES = 25 * 1024 * 1024;
/** Raw JSON body cap for the route (must comfortably exceed the base64 payload). */
const ROUTE_BODY_LIMIT = 40 * 1024 * 1024;

export interface ImportRoutesDeps {
  readonly store: WorkspaceStore;
  /** The converter (production = MarkItDownImporter; tests inject a fake). */
  readonly importer: Importer;
  /** Authorize `action` on the workspace (writes 401/403 and returns false if not). */
  readonly ensureAuthorized: (
    req: FastifyRequest,
    reply: FastifyReply,
    workspaceId: string,
    action: Action,
  ) => Promise<boolean>;
  /** Reflect a freshly imported source into the live Y.Doc (set by main.ts). */
  readonly addSourceToWorkspace?: (id: string, relPath: string, markdown: string) => void;
  /** Override the max decoded upload size. */
  readonly maxImportBytes?: number;
}

interface ImportBody {
  readonly fileName?: string;
  readonly contentBase64?: string;
  readonly out?: string;
}

export function registerImportRoutes(app: FastifyInstance, deps: ImportRoutesDeps): void {
  const maxBytes = deps.maxImportBytes ?? DEFAULT_MAX_IMPORT_BYTES;

  app.post<{ Params: { id: string }; Body: ImportBody }>(
    "/api/workspaces/:id/import",
    { bodyLimit: ROUTE_BODY_LIMIT },
    async (req, reply) => {
      const id = req.params.id;
      if (!(await deps.ensureAuthorized(req, reply, id, "workspace:import"))) return reply;
      const dir = await deps.store.open(id);

      const fileName = req.body?.fileName?.trim();
      const contentBase64 = req.body?.contentBase64;
      if (!fileName || !contentBase64) {
        return reply.code(400).send({ error: "fileName and contentBase64 are required" });
      }

      // Only the basename of the uploaded name is trusted (a client can't smuggle
      // a path); the extension drives the source name and the MarkItDown hint.
      const base = basename(fileName);
      const ext = extname(base);

      const bytes = decodeBase64(contentBase64);
      if (!bytes) return reply.code(400).send({ error: "contentBase64 is not valid base64" });
      if (bytes.length === 0) return reply.code(400).send({ error: "The uploaded file is empty" });
      if (bytes.length > maxBytes) {
        return reply.code(413).send({ error: `File exceeds the ${maxBytes}-byte import limit` });
      }

      // The output is written into the workspace, so it must stay inside it.
      const relOut = req.body?.out?.trim() || join("sources", `${basename(base, ext)}.md`);
      let outAbs: string;
      try {
        outAbs = resolveInWorkspace(dir, relOut);
      } catch (err) {
        if (err instanceof PathEscapeError) return reply.code(400).send({ error: err.message });
        throw err;
      }

      // MarkItDown reads a file path; stage the upload in a throwaway temp file,
      // convert (cached on the bytes), then clean it up.
      const tmp = await mkdtemp(join(tmpdir(), "makedown-import-"));
      let markdown: string;
      let cached: boolean;
      try {
        const tmpFile = join(tmp, base || "upload");
        await writeFile(tmpFile, bytes);
        const result = await importWithCache(
          deps.importer,
          new FileImportCache(join(dir, ".makedown", "imports")),
          { path: tmpFile, bytes, hints: { extensionHint: ext || undefined } },
        );
        markdown = result.markdown;
        cached = result.cached;
      } catch (err) {
        if (err instanceof ImporterError) {
          const status = err.kind === "not_installed" ? 503 : 422;
          return reply.code(status).send({ error: err.message, kind: err.kind });
        }
        throw err;
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => {});
      }

      await mkdir(dirname(outAbs), { recursive: true });
      await writeFile(outAbs, markdown, "utf8");

      const relPosix = relOut.replaceAll("\\", "/");
      deps.addSourceToWorkspace?.(id, relPosix, markdown);

      return reply.code(201).send({ path: relPosix, cached, chars: markdown.length });
    },
  );
}

/**
 * Decode a base64 string to bytes, tolerating a `data:…;base64,` prefix and
 * surrounding whitespace. Returns undefined if the payload isn't valid base64.
 */
function decodeBase64(input: string): Uint8Array | undefined {
  const comma = input.indexOf(",");
  const body = input.startsWith("data:") && comma !== -1 ? input.slice(comma + 1) : input;
  const compact = body.replace(/\s+/g, "");
  if (compact === "" || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return undefined;
  return new Uint8Array(Buffer.from(compact, "base64"));
}
