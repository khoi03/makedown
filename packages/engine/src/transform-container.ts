/**
 * Container-isolated execution for `transform` scripts (Phase 1.5 hardening,
 * Option A). Selected by `sandbox: container`. Runs the script inside Docker so
 * it has — on top of the subprocess sandbox's guarantees — **no network**
 * (`--network none`), no host filesystem (only the script is mounted read-only),
 * and hard CPU/memory/PID caps. This is the strongest isolation Makedown offers
 * and the one option that closes the network gap the Node permission model
 * leaves open (see {@link runSandboxedTransform}).
 *
 * Docker is an **optional** dependency: it is touched only when a target opts
 * into `sandbox: container`. Every other build path runs with zero Docker.
 *
 * The script is copied into a throwaway dir mounted read-only at `/sbx`; inputs
 * arrive on stdin and the result returns on stdout (the in-container runner
 * swallows the script's own stdout so it can't corrupt the result channel —
 * worst case a script only garbles its own artifact, which it authors anyway).
 */
import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  DEFAULT_TRANSFORM_TIMEOUT_MS,
  DEFAULT_TRANSFORM_MEMORY_MB,
  type SandboxedTransformOptions,
} from "./transform-sandbox.js";

const execFileAsync = promisify(execFile);

/** Default image for `sandbox: container`. Override via {@link ContainerTransformOptions.image}. */
export const DEFAULT_TRANSFORM_CONTAINER_IMAGE = "node:lts-alpine";

export interface ContainerTransformOptions extends SandboxedTransformOptions {
  /** Container image to run the script in. Defaults to {@link DEFAULT_TRANSFORM_CONTAINER_IMAGE}. */
  readonly image?: string;
  /** Docker CLI path/name. Defaults to `docker`. Injectable for testing. */
  readonly dockerPath?: string;
}

/**
 * Whether Docker is usable: the daemon is reachable and — when `image` is given
 * — that image is present locally (no network pull is attempted). Returns
 * `false` rather than throwing, so callers/tests can gate cleanly.
 */
export async function isDockerAvailable(image?: string, dockerPath = "docker"): Promise<boolean> {
  try {
    await execFileAsync(dockerPath, ["version", "--format", "{{.Server.Version}}"]);
  } catch {
    return false;
  }
  if (image) {
    try {
      await execFileAsync(dockerPath, ["image", "inspect", image]);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * The in-container runner. Reads `{ inputs }` from stdin, imports the script
 * mounted at `/sbx/script.mjs`, runs it, and writes a single framed JSON result
 * line to stdout — suppressing the script's own stdout during execution so the
 * result channel stays clean.
 */
const CONTAINER_RUNNER = `
import process from "node:process";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", async () => {
  const realWrite = process.stdout.write.bind(process.stdout);
  let payload;
  try {
    const { inputs } = JSON.parse(raw);
    const mod = await import("/sbx/script.mjs");
    const fn = mod.default ?? mod.transform;
    if (typeof fn !== "function") {
      payload = { ok: false, error: 'Transform must export a function (default export or named "transform")' };
    } else {
      process.stdout.write = () => true; // swallow script noise
      const result = await fn(inputs);
      process.stdout.write = realWrite;
      if (typeof result === "string") {
        payload = { ok: true, kind: "string", value: result };
      } else if (result instanceof Uint8Array) {
        payload = { ok: true, kind: "bytes", base64: Buffer.from(result).toString("base64") };
      } else {
        payload = { ok: false, error: "Transform must return a string or Uint8Array (got " + typeof result + ")" };
      }
    }
  } catch (err) {
    payload = { ok: false, error: String((err && err.message) || err) };
  }
  realWrite(JSON.stringify(payload) + "\\n");
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
 * Run a transform script inside a Docker container. Resolves to the script's
 * output (string or bytes); rejects on a thrown error, a non-serializable
 * return, a timeout, or Docker being unavailable (with an actionable hint).
 */
export async function runContainerTransform(
  opts: ContainerTransformOptions,
): Promise<string | Uint8Array> {
  const image = opts.image ?? DEFAULT_TRANSFORM_CONTAINER_IMAGE;
  const dockerPath = opts.dockerPath ?? "docker";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TRANSFORM_TIMEOUT_MS;
  const memoryMb = opts.memoryMb ?? DEFAULT_TRANSFORM_MEMORY_MB;

  const dir = await mkdtemp(join(tmpdir(), "makedown-xfc-"));
  await writeFile(join(dir, "runner.mjs"), CONTAINER_RUNNER, "utf8");
  await copyFile(opts.scriptPath, join(dir, "script.mjs"));
  const name = `makedown-xf-${randomUUID()}`;

  const args = [
    "run",
    "--rm",
    "-i",
    "--name",
    name,
    "--network",
    "none",
    "--memory",
    `${memoryMb}m`,
    "--cpus",
    "1",
    "--pids-limit",
    "128",
    "--read-only",
    "-v",
    `${dir}:/sbx:ro`,
    "-w",
    "/sbx",
    image,
    "node",
    "/sbx/runner.mjs",
  ];

  try {
    const child = spawn(dockerPath, args, { stdio: ["pipe", "pipe", "pipe"] });

    return await new Promise<string | Uint8Array>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        // Force-remove the container (killing the CLI alone can orphan it).
        execFileAsync(dockerPath, ["rm", "-f", name]).catch(() => {});
        child.kill("SIGKILL");
        finish(() =>
          reject(new Error(`Transform (container) timed out after ${timeoutMs}ms (time cap)`)),
        );
      }, timeoutMs);

      child.stdout.on("data", (c: Buffer) => {
        stdout += c.toString();
      });
      child.stderr.on("data", (c: Buffer) => {
        stderr += c.toString();
      });
      child.on("error", (err) => finish(() => reject(dockerSpawnError(err, dockerPath))));
      child.on("close", (code) => {
        finish(() => {
          const line = lastJsonLine(stdout);
          if (!line) {
            reject(new Error(containerFailureMessage(code, stderr, dockerPath)));
            return;
          }
          let parsed: ChildResult;
          try {
            parsed = JSON.parse(line) as ChildResult;
          } catch {
            reject(new Error("Transform (container) produced an unreadable result"));
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

      child.stdin?.end(JSON.stringify({ inputs: opts.inputs }));
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Turn a spawn failure (e.g. missing CLI) into an actionable message. */
function dockerSpawnError(err: NodeJS.ErrnoException, dockerPath: string): Error {
  if (err.code === "ENOENT") {
    return new Error(
      `sandbox: container requires Docker, but the "${dockerPath}" CLI was not found. ` +
        `Install Docker (https://docs.docker.com/get-docker/) or use sandbox: worktree.`,
    );
  }
  return err;
}

/** Explain a non-zero `docker run` exit, surfacing daemon-down and pull hints. */
function containerFailureMessage(code: number | null, stderr: string, dockerPath: string): string {
  const tail = stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : "";
  if (/cannot connect to the docker daemon|daemon running/i.test(stderr)) {
    return `sandbox: container could not reach the Docker daemon — is Docker running? (${dockerPath})`;
  }
  if (/no such image|manifest unknown|pull access denied|not found/i.test(stderr)) {
    return `sandbox: container could not find the image${tail}. Pull it first (e.g. \`docker pull\`).`;
  }
  return `Transform (container) produced no result (exit ${code})${tail}`;
}

/** Parse the last non-empty line of stdout as the framed JSON result. */
function lastJsonLine(stdout: string): string | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.at(-1);
}
