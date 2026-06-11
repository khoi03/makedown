/**
 * Locked-down execution for `transform` scripts (Phase 1.5 hardening).
 *
 * A `transform` is workspace-authored code. To run an untrusted `build.md`
 * safely, the script runs in a forked Node child under the **permission model**
 * (`--permission` with a single allow-listed file) so it has:
 *   - **no ambient filesystem** access (it can't read/write anything, not even
 *     its own siblings — only the engine-resolved input *values* it is handed),
 *   - a **memory cap** (`--max-old-space-size`; an OOM aborts the child), and
 *   - a **wall-clock cap** (the parent SIGKILLs a child that overruns).
 *
 * Inputs are sent over stdin; the result returns over a dedicated pipe (fd 3) so
 * the script's own stdout/stderr can never corrupt it. The child entry is a tiny
 * trusted runner we write to a throwaway temp file — keeping this self-contained
 * (no build-time asset copying) and identical in dev and published builds.
 *
 * Note: Node's permission model does not gate **network**. Transforms receive
 * inputs by value and shouldn't need it; `sandbox: container` (Docker
 * `--network none`) is the option that also closes the network.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Default wall-clock ceiling for a single transform run. */
export const DEFAULT_TRANSFORM_TIMEOUT_MS = 30_000;
/** Default heap ceiling (MB) for a single transform run. */
export const DEFAULT_TRANSFORM_MEMORY_MB = 256;

export interface SandboxedTransformOptions {
  /** Absolute path to the transform script (already workspace-confined). */
  readonly scriptPath: string;
  /** Resolved input contents, passed to the script by value. */
  readonly inputs: Record<string, string>;
  readonly timeoutMs?: number;
  readonly memoryMb?: number;
}

/**
 * The child entry. Reads `{ scriptUrl, inputs }` from stdin, imports the script,
 * runs its default (or named `transform`) export, and writes a single framed
 * JSON result to fd 3. Kept dependency-free so it needs no fs permission beyond
 * the one allow-listed script. Written verbatim to a temp `.mjs` at runtime.
 */
const CHILD_RUNNER = `
import process from "node:process";
import { writeSync } from "node:fs";

function send(payload) {
  try { writeSync(3, JSON.stringify(payload)); } catch { /* parent gone */ }
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", async () => {
  try {
    const { scriptUrl, inputs } = JSON.parse(raw);
    const mod = await import(scriptUrl);
    const fn = mod.default ?? mod.transform;
    if (typeof fn !== "function") {
      send({ ok: false, error: 'Transform must export a function (default export or named "transform")' });
      return;
    }
    const result = await fn(inputs);
    if (typeof result === "string") {
      send({ ok: true, kind: "string", value: result });
    } else if (result instanceof Uint8Array) {
      send({ ok: true, kind: "bytes", base64: Buffer.from(result).toString("base64") });
    } else {
      send({ ok: false, error: "Transform must return a string or Uint8Array (got " + typeof result + ")" });
    }
  } catch (err) {
    send({ ok: false, error: String((err && err.message) || err) });
  }
});
`;

interface ChildResult {
  readonly ok: boolean;
  readonly kind?: "string" | "bytes";
  readonly value?: string;
  readonly base64?: string;
  readonly error?: string;
}

/**
 * Run a transform script in the sandboxed child. Resolves to the script's
 * output (string or bytes); rejects on a thrown error, a denied syscall, a
 * timeout, a memory overrun, or a non-serializable return.
 */
export async function runSandboxedTransform(
  opts: SandboxedTransformOptions,
): Promise<string | Uint8Array> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TRANSFORM_TIMEOUT_MS;
  const memoryMb = opts.memoryMb ?? DEFAULT_TRANSFORM_MEMORY_MB;

  const runnerDir = await mkdtemp(join(tmpdir(), "makedown-xf-"));
  const runnerPath = join(runnerDir, "runner.mjs");
  await writeFile(runnerPath, CHILD_RUNNER, "utf8");

  try {
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${memoryMb}`,
        "--permission",
        `--allow-fs-read=${opts.scriptPath}`,
        runnerPath,
      ],
      // Scrub the environment: the permission model blocks filesystem but not
      // `process.env`, so an inherited env would hand an untrusted script the
      // workspace's API keys (which it could exfiltrate — network is not gated).
      // Trusted transforms that need env should use `sandbox: none`.
      { stdio: ["pipe", "ignore", "pipe", "pipe"], env: minimalEnv() },
    );

    return await new Promise<string | Uint8Array>((resolve, reject) => {
      let resultRaw = "";
      let stderr = "";
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() =>
          reject(new Error(`Transform timed out after ${timeoutMs}ms (time cap)`)),
        );
      }, timeoutMs);

      // fd 3: the dedicated, noise-free result channel.
      child.stdio[3]?.on("data", (c: Buffer) => {
        resultRaw += c.toString();
      });
      child.stderr?.on("data", (c: Buffer) => {
        stderr += c.toString();
      });
      child.on("error", (err) => finish(() => reject(err)));
      child.on("close", (code, signal) => {
        finish(() => {
          if (!resultRaw) {
            const why = signal
              ? `killed by ${signal}` + (signal === "SIGABRT" ? " (likely memory cap)" : "")
              : `exited with code ${code}`;
            const detail = stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : "";
            reject(new Error(`Transform crashed (${why})${detail}`));
            return;
          }
          let parsed: ChildResult;
          try {
            parsed = JSON.parse(resultRaw) as ChildResult;
          } catch {
            reject(new Error("Transform produced an unreadable result"));
            return;
          }
          if (!parsed.ok) {
            reject(new Error(parsed.error ?? "Transform failed"));
            return;
          }
          if (parsed.kind === "bytes") {
            resolve(new Uint8Array(Buffer.from(parsed.base64 ?? "", "base64")));
          } else {
            resolve(parsed.value ?? "");
          }
        });
      });

      child.stdin?.end(
        JSON.stringify({ scriptUrl: pathToFileURL(opts.scriptPath).href, inputs: opts.inputs }),
      );
    });
  } finally {
    await rm(runnerDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A minimal environment for the sandboxed child: no secrets. Keeps only the
 * non-sensitive OS essentials a Node runtime may need (Windows path roots);
 * notably omits every API key/credential the parent holds.
 */
function minimalEnv(): NodeJS.ProcessEnv {
  const keep = process.platform === "win32" ? ["SystemRoot", "windir", "TEMP", "TMP"] : [];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
