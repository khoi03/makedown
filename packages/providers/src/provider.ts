/**
 * Provider abstraction. The engine depends only on this interface, so adding a
 * model vendor is a new adapter — no engine changes. Cost/token accounting is
 * part of the contract (it feeds provenance and `md cost`).
 */
import type { TokenUsage } from "@makedown/shared";

export interface CompletionRequest {
  readonly model: string;
  /** Optional system prompt. */
  readonly system?: string;
  readonly prompt: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface CompletionResult {
  readonly text: string;
  readonly usage: TokenUsage;
  /** Estimated USD cost, if the adapter can compute it. */
  readonly costUsd?: number;
}

export interface Provider {
  readonly id: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
