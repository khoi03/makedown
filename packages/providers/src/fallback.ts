/**
 * Multi-model fallback. Given an ordered candidate chain, try each model in turn,
 * advancing only on a *transient* error (rate-limit / overload / network) and
 * failing fast on a fatal one (bad request / auth). This is the Phase 3 routing
 * moat layered on top of the existing `provider:model` router.
 *
 * Determinism note: the chain is derived purely from the recipe spec (declared
 * `model` + `fallback` + `route`), never from runtime state, so a target's
 * identity hash is unaffected by which model actually answered. The model that
 * *did* answer is reported on the result so the engine can record it in
 * provenance. See SPEC.md §5/§7.
 */
import type { RoutePolicy } from "@makedown/shared";
import type { CompletionResult } from "./provider.js";
import { ProviderError, isRetryable, shouldRetrySameModel } from "./errors.js";
import { blendedPrice } from "./pricing.js";
import { DEFAULT_RETRY_POLICY, backoffDelayMs, realSleep, type RetryPolicy, type Sleep } from "./retry.js";

/**
 * Build the ordered candidate chain. The declared primary always runs first
 * (strict intent). Under `cost-aware`, the *fallback* alternatives are reordered
 * cheapest-first (unknown-priced models last); under `strict` they keep declared
 * order. Duplicates are removed, keeping the earliest position.
 */
export function buildChain(
  model: string,
  fallback: readonly string[] | undefined,
  route: RoutePolicy | undefined,
  defaultProvider: string,
): string[] {
  const alternatives = fallback ? [...fallback] : [];
  const ordered =
    route === "cost-aware" ? sortByCost(alternatives, defaultProvider) : alternatives;
  return dedupe([model, ...ordered]);
}

/** Stable ascending sort by blended price; unpriced models sort last. */
function sortByCost(refs: readonly string[], defaultProvider: string): string[] {
  return refs
    .map((ref, index) => ({ ref, index, price: blendedPrice(ref, defaultProvider) }))
    .sort((a, b) => {
      const ap = a.price ?? Infinity;
      const bp = b.price ?? Infinity;
      return ap !== bp ? ap - bp : a.index - b.index;
    })
    .map((entry) => entry.ref);
}

function dedupe(refs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of refs) {
    if (!seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  }
  return out;
}

/** Tuning + test seams for {@link runWithFallback}. */
export interface FallbackOptions {
  /** Overrides merged over {@link DEFAULT_RETRY_POLICY}. */
  readonly retry?: Partial<RetryPolicy>;
  /** Injectable delay (tests pass a no-op so they never actually wait). */
  readonly sleep?: Sleep;
  /** Injectable RNG for deterministic jitter in tests. */
  readonly rand?: () => number;
}

/**
 * Walk the chain, calling `run(model)` for each candidate. Returns the first
 * success (stamping `model` when the runner left it blank).
 *
 * Per model: a *transient* failure (load/throttle/network) is retried on the
 * same model with exponential backoff up to `maxAttemptsPerModel`, before the
 * router advances — so the model you actually asked for isn't demoted over a
 * momentary blip. After attempts are exhausted (or for a non-same-model
 * retryable like `unavailable`) it advances to the next candidate. A fatal error
 * or chain exhaustion throws — the raw error for a single failed model, or an
 * aggregate summarizing every model that failed.
 */
export async function runWithFallback(
  chain: readonly string[],
  run: (model: string) => Promise<CompletionResult>,
  options: FallbackOptions = {},
): Promise<CompletionResult> {
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
  const sleep = options.sleep ?? realSleep;
  const rand = options.rand ?? Math.random;
  const failures: { readonly model: string; readonly error: unknown }[] = [];

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]!;
    const isLast = i === chain.length - 1;

    for (let attempt = 1; ; attempt++) {
      try {
        const result = await run(model);
        return result.model ? result : { ...result, model };
      } catch (error) {
        // Transient on this model: back off and retry the same model, bounded.
        if (shouldRetrySameModel(error) && attempt < policy.maxAttemptsPerModel) {
          const retryAfterMs = error instanceof ProviderError ? error.retryAfterMs : undefined;
          await sleep(backoffDelayMs(attempt, policy, retryAfterMs, rand));
          continue;
        }
        // Give up on this model: advance to the next candidate, or fail.
        failures.push({ model, error });
        if (isLast || !isRetryable(error)) {
          throw failures.length > 1 ? aggregateError(failures) : error;
        }
        break;
      }
    }
  }

  // Only reachable if the chain was empty; the router guarantees it is not.
  throw new Error("runWithFallback: empty model chain");
}

function aggregateError(failures: readonly { readonly model: string; readonly error: unknown }[]): Error {
  const summary = failures.map((f) => `${f.model} (${describe(f.error)})`).join(" → ");
  return new Error(`All ${failures.length} models failed: ${summary}`, {
    cause: failures[failures.length - 1]?.error,
  });
}

function describe(error: unknown): string {
  if (error instanceof ProviderError) return error.kind;
  if (error instanceof Error) return error.message;
  return String(error);
}
