/**
 * Claude Code agent runner — the production {@link AgentRunner} that drives a
 * general-purpose coding agent via `@anthropic-ai/claude-agent-sdk`.
 *
 * The SDK is **not** a dependency of this repo: it's dynamic-imported by name so
 * the workspace installs it only when it actually runs `agent` steps. When it's
 * absent the user gets an actionable install hint instead of a stack trace.
 *
 * Isolation is the engine's job: it provisions a throwaway git worktree and
 * passes it as `workdir`, so the agent edits a copy, never your working tree.
 * `permissionMode: bypassPermissions` is therefore safe here — the sandbox, not
 * an interactive prompt, is the boundary.
 */
import type { AgentRunner, AgentRunRequest, AgentRunResult } from "./runner.js";

const SDK_MODULE = "@anthropic-ai/claude-agent-sdk";

/** The single SDK message we care about: the terminal result + its accounting. */
interface SdkResultMessage {
  readonly type: "result";
  readonly result?: string;
  readonly total_cost_usd?: number;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

type SdkMessage = { readonly type: string } & Partial<SdkResultMessage>;

/** Structural shape of the SDK's `query` export (only what we use). */
export type AgentQuery = (args: {
  readonly prompt: string;
  readonly options: Record<string, unknown>;
}) => AsyncIterable<SdkMessage>;

/**
 * Resolve the Agent SDK's `query` function, or throw an actionable hint if the
 * package isn't installed. Only a genuine module-not-found is translated to the
 * hint; any other import error rethrows so real bugs aren't masked.
 */
export async function loadAgentSdk(moduleName: string = SDK_MODULE): Promise<AgentQuery> {
  try {
    const mod = (await import(moduleName)) as { query?: AgentQuery };
    if (typeof mod.query !== "function") {
      throw new Error(`"${moduleName}" does not export a query() function`);
    }
    return mod.query;
  } catch (err) {
    if (isModuleNotFound(err, moduleName)) {
      throw new Error(
        `The "${moduleName}" package is required to run agent steps but is not installed. ` +
          `Install it in your workspace: npm install ${moduleName}`,
      );
    }
    throw err;
  }
}

function isModuleNotFound(err: unknown, moduleName: string): boolean {
  const code = (err as { code?: string })?.code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return true;
  const message = err instanceof Error ? err.message : String(err);
  return (
    /cannot find (package|module)|err_module_not_found|failed to load url/i.test(message) &&
    message.includes(moduleName)
  );
}

export class ClaudeCodeAgentRunner implements AgentRunner {
  readonly id = "claude-code";

  /** `query` is injectable for testing; production resolves the real SDK lazily. */
  constructor(private readonly query?: AgentQuery) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const query = this.query ?? (await loadAgentSdk());
    const options: Record<string, unknown> = {
      cwd: request.workdir,
      permissionMode: "bypassPermissions",
    };
    if (request.model) options["model"] = request.model;
    if (request.system) options["systemPrompt"] = request.system;

    let output = "";
    let usage = { input: 0, output: 0 };
    let costUsd: number | undefined;

    for await (const message of query({ prompt: request.prompt, options })) {
      if (message.type === "result") {
        output = message.result ?? "";
        costUsd = message.total_cost_usd;
        usage = {
          input: message.usage?.input_tokens ?? 0,
          output: message.usage?.output_tokens ?? 0,
        };
      }
    }

    return { output, usage, costUsd, producedBy: `agent:${this.id}` };
  }
}
