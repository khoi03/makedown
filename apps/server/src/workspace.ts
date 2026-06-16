/**
 * Workspace service: resolve a workspace id to a directory (path-safe), load its
 * `build.md`, and assemble a server-side {@link BuildContext}. The context wiring
 * mirrors the CLI's `makeContext` but takes injected progress/approval hooks so
 * the {@link BuildManager} can stream events and broker approvals.
 */
import { readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import { LocalCas, type BuildContext, type BuildEvent, type ApprovalRequest } from "@makedown/engine";
import { createProviderRouter, type ProviderRouterConfig } from "@makedown/providers";
import { ClaudeCodeAgentRunner } from "@makedown/agents";
import {
  MarkItDownImporter,
  FileImportCache,
  markitdownCommandFromEnv,
  type Importer,
  type ImportCacheStore,
} from "@makedown/import";
import type { BuildDoc } from "@makedown/shared";

const BUILD_FILE = "build.md";

/** A workspace id must be a single safe path segment (no traversal, no dots). */
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export class InvalidWorkspaceIdError extends Error {
  constructor(id: string) {
    super(`Invalid workspace id: ${JSON.stringify(id)}`);
    this.name = "InvalidWorkspaceIdError";
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(id: string) {
    super(`Workspace not found: ${id}`);
    this.name = "WorkspaceNotFoundError";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Maps workspace ids to directories under a single root, safely. */
export class WorkspaceStore {
  constructor(private readonly root: string) {}

  /** Resolve an id to its directory. Throws on an unsafe id (no IO). */
  resolve(id: string): string {
    if (!WORKSPACE_ID.test(id)) throw new InvalidWorkspaceIdError(id);
    return join(this.root, id);
  }

  /** Resolve and verify the workspace exists (has a build.md). */
  async open(id: string): Promise<string> {
    const dir = this.resolve(id);
    if (!(await exists(join(dir, BUILD_FILE)))) throw new WorkspaceNotFoundError(id);
    return dir;
  }

  /** List workspace ids (directories under the root that contain a build.md). */
  async list(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !WORKSPACE_ID.test(entry.name)) continue;
      if (await exists(join(this.root, entry.name, BUILD_FILE))) ids.push(entry.name);
    }
    return ids;
  }
}

/** Parse a workspace's build.md into a {@link BuildDoc}. */
export async function loadDoc(dir: string): Promise<BuildDoc> {
  const text = await readFile(join(dir, BUILD_FILE), "utf8");
  return parseBuildDoc(text);
}

type Env = Record<string, string | undefined>;

/** Build a provider-router config from environment variables. */
export function routerConfigFromEnv(env: Env = process.env): ProviderRouterConfig {
  const anthropicKey = env["ANTHROPIC_API_KEY"];
  const openaiKey = env["OPENAI_API_KEY"];
  return {
    defaultProvider: env["MAKEDOWN_DEFAULT_PROVIDER"] ?? "anthropic",
    anthropic: anthropicKey ? { apiKey: anthropicKey, baseUrl: env["ANTHROPIC_BASE_URL"] } : undefined,
    openai: openaiKey ? { apiKey: openaiKey, baseUrl: env["OPENAI_BASE_URL"] } : undefined,
  };
}

function hasAnyProvider(env: Env): boolean {
  return Boolean(env["ANTHROPIC_API_KEY"] || env["OPENAI_API_KEY"]);
}

/**
 * The any-file → Markdown importer + content-addressed cache that power in-graph
 * auto-import (a non-Markdown file named directly in `inputs:`). Built per
 * workspace; the MarkItDown tool is probed lazily, only when such an input
 * appears. The server host must have MarkItDown installed for binary inputs.
 */
export function makeImportDeps(dir: string): {
  importer: Importer;
  importCache: ImportCacheStore;
} {
  return {
    importer: new MarkItDownImporter({ command: markitdownCommandFromEnv() }),
    importCache: new FileImportCache(join(dir, ".makedown", "imports")),
  };
}

/** Progress + approval hooks injected by the build manager. */
export interface ServerContextHooks {
  readonly onProgress: (event: BuildEvent) => void;
  readonly approve: (request: ApprovalRequest) => Promise<boolean>;
}

export interface ServerContextOptions {
  /** Environment to read provider credentials from. Defaults to `process.env`. */
  readonly env?: Env;
  /** Override the map fan-out cap for this build. */
  readonly maxMapFanout?: number;
}

/**
 * Assemble a {@link BuildContext} for a workspace. Wires a local CAS, a provider
 * router + agent runner (when credentials exist), and the manager's hooks. With
 * no provider keys, `provider` is omitted so transform-only builds still run.
 */
export function makeServerContext(
  dir: string,
  hooks: ServerContextHooks,
  opts: ServerContextOptions = {},
): BuildContext {
  const env = opts.env ?? process.env;
  const withProvider = hasAnyProvider(env);
  return {
    workspaceDir: dir,
    cas: new LocalCas(join(dir, ".makedown")),
    provider: withProvider ? createProviderRouter(routerConfigFromEnv(env)) : undefined,
    agentRunner: withProvider ? new ClaudeCodeAgentRunner() : undefined,
    ...makeImportDeps(dir),
    onProgress: hooks.onProgress,
    approve: hooks.approve,
    maxMapFanout: opts.maxMapFanout,
  };
}
