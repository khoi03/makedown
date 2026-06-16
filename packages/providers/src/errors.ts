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

/**
 * Kinds worth retrying on the *same* model after a short backoff: transient
 * load / throttling / network blips that a brief wait typically clears. Excludes
 * `unavailable` (a missing/unconfigured model won't materialize on retry — the
 * router should advance immediately) and all fatal kinds.
 */
const RETRY_SAME_MODEL_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  "rate_limit",
  "overload",
  "server",
  "timeout",
]);

/** A normalized error from a provider adapter. */
export class ProviderError extends Error {
  /** Provider-suggested wait before retrying (from a `Retry-After` header), in ms. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly provider: string,
    readonly status?: number,
    options?: { readonly cause?: unknown; readonly retryAfterMs?: number },
  ) {
    super(message, options);
    this.name = "ProviderError";
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/** True when the error is transient and a different model is worth trying. */
export function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError && RETRYABLE_KINDS.has(error.kind);
}

/** True when retrying the *same* model after a backoff is worthwhile. */
export function shouldRetrySameModel(error: unknown): boolean {
  return error instanceof ProviderError && RETRY_SAME_MODEL_KINDS.has(error.kind);
}

/**
 * Parse an HTTP `Retry-After` value into milliseconds. Accepts a raw header
 * string, a `Headers`-like object (anything with a `.get`), or undefined.
 * Supports the delta-seconds form (e.g. `"5"`); an HTTP-date form resolves to
 * the delay from now (never negative). Returns undefined when absent/unparseable.
 */
export function parseRetryAfter(source: string | { get(name: string): string | null } | undefined): number | undefined {
  const raw = typeof source === "string" ? source : source?.get("retry-after") ?? undefined;
  if (raw == null || raw.trim() === "") return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));

  const when = Date.parse(raw);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return undefined;
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
