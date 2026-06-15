/**
 * MarkItDown importer — the production {@link Importer}, driving Microsoft's
 * `markitdown` CLI to convert any-file → Markdown.
 *
 * `markitdown` is a **Python** tool, not a JS dependency of this repo: it's
 * invoked as an optional external command, mirroring how the Docker `container`
 * sandbox and the Claude Agent SDK are optional. When it's absent the user gets
 * an actionable `pip install` hint instead of a stack trace. We invoke it with
 * an **argv array** (no shell) and confine it with a wall-clock timeout and an
 * output-size cap (see {@link defaultConvertExec}).
 *
 * MarkItDown reads a file path and writes Markdown to stdout (`markitdown
 * file.pdf`); we capture stdout. Format hints map to its `-x`/`-m`/`-c` flags.
 */
import {
  ImporterError,
  defaultConvertExec,
  type ConvertExec,
  type Importer,
  type ImportRequest,
  type ImportResult,
} from "./importer.js";

/** Default command (assumes `markitdown` is on PATH after `pip install`). */
export const DEFAULT_MARKITDOWN_COMMAND = "markitdown";
/** Wall-clock ceiling for a single conversion. */
export const DEFAULT_IMPORT_TIMEOUT_MS = 120_000;
/** Output-size ceiling for a single conversion (guards against pathological blowups). */
export const DEFAULT_IMPORT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** The pip package + extras users need; surfaced in the not-installed hint. */
export const MARKITDOWN_INSTALL_HINT =
  "Install it with: pip install 'markitdown[all]' (or python -m pip install 'markitdown[all]')";

export interface MarkItDownOptions {
  /**
   * Override the command. A single string is one executable (its path may
   * contain spaces — it is not tokenized); an array is an executable plus fixed
   * leading args, e.g. `["python", "-m", "markitdown"]`.
   */
  readonly command?: string | readonly string[];
  /** Injectable subprocess runner (tests inject a fake; default spawns the CLI). */
  readonly exec?: ConvertExec;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export class MarkItDownImporter implements Importer {
  readonly id = "markitdown";
  private readonly exe: string;
  private readonly leadArgs: readonly string[];
  private readonly exec: ConvertExec;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(opts: MarkItDownOptions = {}) {
    const command = opts.command ?? DEFAULT_MARKITDOWN_COMMAND;
    const [exe, ...lead] = Array.isArray(command) ? command : [command as string];
    this.exe = exe ?? DEFAULT_MARKITDOWN_COMMAND;
    this.leadArgs = lead;
    this.exec = opts.exec ?? defaultConvertExec;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS;
    this.maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_IMPORT_MAX_OUTPUT_BYTES;
  }

  async version(): Promise<string> {
    const result = await this.run(["--version"]);
    // e.g. "markitdown 0.1.6" → "0.1.6"; fall back to a stable sentinel.
    const match = result.stdout.match(/(\d+\.\d+\.\d+(?:[.\w-]*)?)/);
    return match?.[1] ?? "unknown";
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.version();
      return true;
    } catch {
      return false;
    }
  }

  async convert(request: ImportRequest): Promise<ImportResult> {
    const result = await this.run([request.path, ...hintArgs(request)]);

    if (result.tooLarge) {
      throw new ImporterError(
        "output_too_large",
        `Converting "${request.path}" exceeded the ${this.maxOutputBytes}-byte output cap`,
      );
    }
    if (result.timedOut) {
      throw new ImporterError(
        "timeout",
        `Converting "${request.path}" timed out after ${this.timeoutMs}ms`,
      );
    }
    if (result.code !== 0) {
      throw new ImporterError(
        "conversion_failed",
        `markitdown failed to convert "${request.path}"${tail(result.stderr)}`,
      );
    }
    if (result.stdout.trim() === "") {
      throw new ImporterError(
        "conversion_failed",
        `markitdown produced no output for "${request.path}" — the file may be empty or an unsupported format`,
      );
    }
    return { markdown: result.stdout, producedBy: this.id };
  }

  /** Run the CLI, translating a missing-binary failure into a not_installed error. */
  private async run(args: readonly string[]) {
    try {
      return await this.exec(this.exe, [...this.leadArgs, ...args], {
        timeoutMs: this.timeoutMs,
        maxOutputBytes: this.maxOutputBytes,
        // Force UTF-8 on the child so non-ASCII output isn't mangled by the host
        // console codepage (MarkItDown writes stdout with the locale encoding +
        // errors='replace', which would turn e.g. an em dash into U+FFFD on
        // Windows). We capture stdout as UTF-8, so the producer must emit UTF-8.
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      });
    } catch (err) {
      if (isNotFound(err)) {
        throw new ImporterError(
          "not_installed",
          `The "markitdown" command was not found. ${MARKITDOWN_INSTALL_HINT}`,
          { cause: err },
        );
      }
      throw err;
    }
  }
}

/** Map import hints to MarkItDown CLI flags, each as a discrete argv entry. */
function hintArgs(request: ImportRequest): string[] {
  const args: string[] = [];
  if (request.extensionHint) args.push("-x", request.extensionHint);
  if (request.mimeHint) args.push("-m", request.mimeHint);
  if (request.charsetHint) args.push("-c", request.charsetHint);
  return args;
}

/** A short, single-line tail of stderr for an error message. */
function tail(stderr: string): string {
  const trimmed = stderr.trim();
  if (!trimmed) return "";
  const lastLine = trimmed.split("\n").slice(-1)[0]?.trim() ?? "";
  return `: ${lastLine}`;
}

/** Whether an error is a "command not found" (ENOENT) from spawn. */
function isNotFound(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "ENOENT";
}

/**
 * Resolve a MarkItDown command override from the environment, suitable for
 * {@link MarkItDownOptions.command}. Set `MAKEDOWN_MARKITDOWN_CMD` when the
 * `markitdown` shim isn't on PATH — most commonly `python -m markitdown` (e.g.
 * after a `pip install --user` on Windows, where the Scripts dir is often off
 * PATH). A multi-token value splits into an argv array so nothing is
 * shell-interpreted; an exe path with spaces should be put on PATH instead.
 */
export function markitdownCommandFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | string[] | undefined {
  const raw = env["MAKEDOWN_MARKITDOWN_CMD"]?.trim();
  if (!raw) return undefined;
  const parts = raw.split(/\s+/);
  return parts.length === 1 ? parts[0] : parts;
}
