/**
 * Structured provider errors. Adapters translate vendor/HTTP failures into a
 * `ProviderError` carrying a `kind` so the fallback router (see fallback.ts) can
 * decide whether to advance to the next model (transient) or fail fast (fatal).
 * Keeping this classification in the provider layer means the engine never has
 * to know about HTTP status codes.
 */

export type ProviderErrorKind =
  | "rate_limit" // 429 — provider throttling; another model may have headroom
  | "overload" // 503 — provider temporarily over capacity
  | "server" // other 5xx — transient backend failure
  | "timeout" // network error / request timeout / aborted
  | "unavailable" // 404 model-not-found or provider not configured — try the next model
  | "auth" // 401/403 — bad/blocked credentials; retrying elsewhere won't help here
  | "bad_request" // 400/422 — malformed request or content policy; fatal
  | "unknown"; // unmapped — treated as fatal (conservative)

/** Kinds for which the fallback router should advance to the next candidate. */
const RETRYABLE_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  "rate_limit",
  "overload",
  "server",
  "timeout",
  "unavailable",
]);

/** A normalized error from a provider adapter. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly provider: string,
    readonly status?: number,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

/** True when the error is transient and a different model is worth trying. */
export function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError && RETRYABLE_KINDS.has(error.kind);
}

/** Map an HTTP status code to a provider-error kind. */
export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 503) return "overload";
  if (status === 408 || status === 504) return "timeout";
  if (status === 404) return "unavailable";
  if (status >= 500) return "server";
  if (status === 401 || status === 403) return "auth";
  if (status === 400 || status === 422) return "bad_request";
  return "unknown";
}
