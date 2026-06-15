/**
 * Importer abstraction — the source-ingestion counterpart to the `Provider`
 * (@makedown/providers) and `AgentRunner` (@makedown/agents) interfaces. The
 * engine and CLI depend only on this interface, so the actual any-file → Markdown
 * converter is an injected adapter, never a hard dependency. Tests inject a fake;
 * production wires {@link MarkItDownImporter}, which shells out to the Microsoft
 * MarkItDown CLI (an optional external tool).
 *
 * An importer turns a non-Markdown source file (PDF, DOCX, PPTX, XLSX, HTML,
 * images, …) into Markdown text that can then enter the engine's
 * content-addressed input boundary — hashable, referenceable as `{{sources/…}}`,
 * and provenance-tracked like any other source.
 */
import { spawn } from "node:child_process";

/** A request to convert one source file to Markdown. */
export interface ImportRequest {
  /** Absolute path to the source file to convert. */
  readonly path: string;
  /** Format hint, e.g. `.pdf` — useful when the path lacks a meaningful extension. */
  readonly extensionHint?: string;
  /** MIME hint, e.g. `application/pdf`. */
  readonly mimeHint?: string;
  /** Charset hint, e.g. `utf-8`. */
  readonly charsetHint?: string;
}

/** The converted result. */
export interface ImportResult {
  /** The Markdown rendering of the source. */
  readonly markdown: string;
  /** Identifier of the producing importer (recorded in provenance), e.g. "markitdown". */
  readonly producedBy: string;
}

export interface Importer {
  readonly id: string;
  /**
   * A stable version string for the underlying tool, folded into the conversion
   * cache key so a tool upgrade transparently re-imports (its output may differ).
   */
  version(): Promise<string>;
  /** Whether the underlying tool is usable. Never throws — resolves false if absent. */
  isAvailable(): Promise<boolean>;
  /** Convert one source file to Markdown. Throws {@link ImporterError} on failure. */
  convert(request: ImportRequest): Promise<ImportResult>;
}

/** Why an import failed — lets callers give precise, actionable messages. */
export type ImporterErrorKind =
  | "not_installed"
  | "timeout"
  | "output_too_large"
  | "conversion_failed";

/** A classified import failure (mirrors `ProviderError` in @makedown/providers). */
export class ImporterError extends Error {
  constructor(
    readonly kind: ImporterErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ImporterError";
  }
}

// ── Subprocess execution seam ────────────────────────────────────────────────

/** The outcome of running the converter CLI once. */
export interface ConvertExecResult {
  /** Captured standard output (the converted Markdown, or `--version` text). */
  readonly stdout: string;
  /** Captured standard error (diagnostics; surfaced on failure). */
  readonly stderr: string;
  /** Process exit code, or `null` if it was killed by a signal. */
  readonly code: number | null;
  /** Signal that killed the process, if any. */
  readonly signal: NodeJS.Signals | null;
  /** True if the process was killed for exceeding the wall-clock cap. */
  readonly timedOut: boolean;
  /** True if the process was killed for exceeding the output-size cap. */
  readonly tooLarge?: boolean;
}

export interface ConvertExecOptions {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

/**
 * Run the converter and resolve its captured output. Injectable so the importer
 * is unit-testable without a real subprocess. Must reject with an `err.code`
 * of `"ENOENT"` when the executable cannot be found.
 */
export type ConvertExec = (
  command: string,
  args: readonly string[],
  opts: ConvertExecOptions,
) => Promise<ConvertExecResult>;

/**
 * The production {@link ConvertExec}: spawns the command with an **argv array**
 * (never a shell string, so nothing the caller passes is interpreted by a
 * shell), enforces a wall-clock timeout (SIGKILL on overrun) and an output-size
 * cap (SIGKILL if the converter emits more than `maxOutputBytes`). `command` is
 * a single executable — it is **not** tokenized, so an absolute path containing
 * spaces (e.g. `C:\Program Files\…\markitdown.exe`) works as-is; multi-token
 * invocations like `python -m markitdown` are expressed by the caller as
 * separate argv entries, not a packed string.
 */
export const defaultConvertExec: ConvertExec = (command, args, opts) => {
  return new Promise<ConvertExecResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let timedOut = false;
    let tooLarge = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > opts.maxOutputBytes) {
        tooLarge = true;
        child.kill("SIGKILL");
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      // Bound stderr too so a chatty failure can't exhaust memory.
      if (stderr.length < 64 * 1024) stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr,
        code,
        signal,
        timedOut,
        tooLarge,
      });
    });
  });
};
