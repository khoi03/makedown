/** Workspace loading helpers shared by the CLI commands. */
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { parseBuildDoc } from "@makedown/format";
import { LocalCas, type BuildContext } from "@makedown/engine";
import { createProviderRouter, type ProviderRouterConfig } from "@makedown/providers";
import type { BuildDoc } from "@makedown/shared";

export const BUILD_FILE = "build.md";

export function resolveDir(dir?: string): string {
  if (!dir) return process.cwd();
  return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
}

export async function loadDoc(dir: string): Promise<BuildDoc> {
  const text = await readFile(join(dir, BUILD_FILE), "utf8");
  return parseBuildDoc(text);
}

/** True if at least one model provider is configured in the environment. */
export function hasAnyProvider(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"] || process.env["OPENAI_API_KEY"]);
}

/** Build a multi-provider router config from environment variables. */
export function routerConfigFromEnv(): ProviderRouterConfig {
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  const openaiKey = process.env["OPENAI_API_KEY"];
  return {
    defaultProvider: process.env["MAKEDOWN_DEFAULT_PROVIDER"] ?? "anthropic",
    anthropic: anthropicKey
      ? { apiKey: anthropicKey, baseUrl: process.env["ANTHROPIC_BASE_URL"] }
      : undefined,
    openai: openaiKey
      ? { apiKey: openaiKey, baseUrl: process.env["OPENAI_BASE_URL"] }
      : undefined,
  };
}

/** Build a BuildContext. A provider router is attached only when requested. */
export function makeContext(dir: string, withProvider = false): BuildContext {
  const cas = new LocalCas(join(dir, ".makedown"));
  const provider = withProvider ? createProviderRouter(routerConfigFromEnv()) : undefined;
  return { workspaceDir: dir, cas, provider };
}
