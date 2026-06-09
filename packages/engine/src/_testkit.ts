/**
 * Shared test helpers for the engine package. Not a test file (no `.test.`
 * suffix) so vitest ignores it for collection but tests can import it.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompletionRequest, CompletionResult, Provider } from "@makedown/providers";
import { LocalCas } from "./cas.js";
import type { BuildContext } from "./build.js";

/** A deterministic in-memory provider that records every request it receives. */
export class FakeProvider implements Provider {
  readonly id = "fake";
  readonly calls: CompletionRequest[] = [];
  private readonly responder: (req: CompletionRequest) => string;

  constructor(responder?: (req: CompletionRequest) => string) {
    this.responder = responder ?? ((req) => `OUT(${req.prompt})`);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    return { text: this.responder(req), usage: { input: 1, output: 2 }, costUsd: 0.01 };
  }
}

/** A fixed clock so provenance timestamps are deterministic in tests. */
export const FIXED_NOW = (): Date => new Date("2026-06-09T00:00:00.000Z");

export interface Workspace {
  readonly dir: string;
  ctx(provider?: Provider): BuildContext;
  write(relPath: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** Create a throwaway workspace directory with a deterministic build context. */
export async function makeWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "makedown-"));
  return {
    dir,
    ctx(provider?: Provider): BuildContext {
      return {
        workspaceDir: dir,
        cas: new LocalCas(join(dir, ".makedown")),
        provider,
        now: FIXED_NOW,
      };
    },
    async write(relPath: string, content: string): Promise<void> {
      const path = join(dir, relPath);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, content, "utf8");
    },
    async cleanup(): Promise<void> {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
