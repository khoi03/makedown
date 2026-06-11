/**
 * Agent-runner abstraction — the `agent` step's counterpart to the `Provider`
 * interface in @makedown/providers. The engine depends only on this interface,
 * so the heavy coding-agent SDK is an injected adapter, never a hard dependency.
 * Tests inject a fake; production wires the Claude Agent SDK adapter (claude-code.ts).
 *
 * An agent runner executes a general-purpose coding agent inside a prepared,
 * isolated working directory (a git worktree provisioned by the engine) and
 * reports the produced artifact plus token/cost accounting for provenance.
 */
import type { TokenUsage } from "@makedown/shared";

export interface AgentRunRequest {
  /** Coding-agent runtime id from the recipe (`agent:` field), e.g. "claude-code". */
  readonly agent: string;
  /** Model the agent should use, if the recipe pins one. */
  readonly model?: string;
  /** Optional system prompt (already interpolated). */
  readonly system?: string;
  /** The task instructions (already interpolated from the prompt body). */
  readonly prompt: string;
  /** Recipe params (e.g. max_tokens); advisory, adapter forwards what it accepts. */
  readonly params: Readonly<Record<string, unknown>>;
  /**
   * Absolute path to the isolated sandbox the agent must operate in. The engine
   * provisions and tears this down; the agent must not write outside it.
   */
  readonly workdir: string;
}

export interface AgentRunResult {
  /** The artifact the agent produced (e.g. a unified diff or a summary). */
  readonly output: string;
  readonly usage: TokenUsage;
  /** Estimated USD cost, if the adapter can compute it. */
  readonly costUsd?: number;
  /** Identifier of the producing agent/runtime, recorded in provenance. */
  readonly producedBy?: string;
}

export interface AgentRunner {
  readonly id: string;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
