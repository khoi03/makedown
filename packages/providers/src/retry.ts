/**
 * Retry/backoff policy for the fallback router. Pure, side-effect-free helpers
 * (the actual waiting is injected as a `Sleep`), so this stays trivially testable
 * and Apache-2.0 framework-side.
 *
 * The router retries a *transient* failure on the same model a bounded number of
 * times before advancing the fallback chain — a brief 429/503/timeout on the
 * model you asked for usually clears on its own, and demoting instantly would
 * needlessly downgrade quality or change cost.
 */

export interface RetryPolicy {
  /** Total attempts per model, including the first (1 = no same-model retry). */
  readonly maxAttemptsPerModel: number;
  /** Base backoff delay, doubled each attempt. */
  readonly baseDelayMs: number;
  /** Upper bound on a single computed backoff (a `Retry-After` hint may exceed it). */
  readonly maxDelayMs: number;
  /** Apply jitter so concurrent clients don't retry in lockstep (thundering herd). */
  readonly jitter: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttemptsPerModel: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  jitter: true,
};

/** An injectable delay. Real code waits; tests pass a no-op (or a recorder). */
export type Sleep = (ms: number) => Promise<void>;

/** The default real delay. */
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backoff delay (ms) before the next attempt. `attempt` is 1-based (1 = the wait
 * after the first failure). A positive `retryAfterMs` from the provider wins
 * outright — the server told us exactly how long to wait. Otherwise it's capped
 * exponential growth with *equal jitter* (the result lands in `[exp/2, exp]`),
 * which keeps a sane lower bound while still spreading retries out.
 */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  retryAfterMs?: number,
  rand: () => number = Math.random,
): number {
  if (retryAfterMs != null && retryAfterMs > 0) return retryAfterMs;

  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  if (!policy.jitter) return exp;
  return Math.round(exp / 2 + rand() * (exp / 2));
}
