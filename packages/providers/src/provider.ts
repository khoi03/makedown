/**
 * Provider abstraction. The engine depends only on this interface, so adding a
 * model vendor is a new adapter — no engine changes. Cost/token accounting is
 * part of the contract (it feeds provenance and `md cost`).
 */
import type { RoutePolicy, TokenUsage } from "@makedown/shared";

export interface CompletionRequest {
  readonly model: string;
  /** Optional system prompt. */
  readonly system?: string;
  readonly prompt: string;
  readonly params: Readonly<Record<string, unknown>>;
  /**
   * Ordered fallback models tried when the primary fails with a transient error
   * (rate-limit / overload / network). Each entry is a `provider:model` ref.
   * Only the router acts on this; leaf adapters ignore it.
   */
  readonly fallback?: readonly string[];
  /** How to order the fallback candidates. Default: "strict". */
  readonly route?: RoutePolicy;
}

export interface CompletionResult {
  readonly text: string;
  readonly usage: TokenUsage;
  /** Estimated USD cost, if the adapter can compute it. */
  readonly costUsd?: number;
  /**
   * The model that actually produced this result. May differ from the request's
   * `model` when the router fell back. The engine records this in provenance so
   * a build never misattributes which model made an artifact.
   */
  readonly model?: string;
}

export interface Provider {
  readonly id: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
