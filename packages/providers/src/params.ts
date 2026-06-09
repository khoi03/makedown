/** Shared request-parameter helpers used by every provider adapter. */

/** Default output cap. Non-streaming default per Anthropic guidance (avoids truncation). */
export const DEFAULT_MAX_TOKENS = 16_000;

/** Resolve a positive `max_tokens` from recipe params, else fall back. */
export function resolveMaxTokens(
  params: Readonly<Record<string, unknown>>,
  fallback = DEFAULT_MAX_TOKENS,
): number {
  const raw = params["max_tokens"];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
