/**
 * Model pricing — the single home for the confirmed USD rate table. Used both to
 * estimate a completed call's cost (feeds provenance + `md cost`) and to order
 * fallback candidates cheapest-first under `route: cost-aware`. Pure data + pure
 * functions: no network, no SDK, so it stays Apache-2.0 framework-side.
 */
import { parseModelRef } from "./model-ref.js";

/** USD per 1M tokens, keyed by the bare Anthropic model id. Confirmed (cached 2026-05-26). */
const PRICING: Readonly<Record<string, { input: number; output: number }>> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * Reduce a possibly-prefixed model id to the bare id used as a pricing key:
 * - strips a gateway path prefix:  `cc/claude-sonnet-4-6` -> `claude-sonnet-4-6`
 * - strips a Bedrock vendor dot:   `anthropic.claude-opus-4-8` -> `claude-opus-4-8`
 */
export function normalizeModelId(model: string): string {
  const lastSlash = model.lastIndexOf("/");
  let id = lastSlash === -1 ? model : model.slice(lastSlash + 1);
  if (id.startsWith("anthropic.")) id = id.slice("anthropic.".length);
  return id;
}

/** Look up the rate for a bare model id, trying the exact then normalized form. */
function rateFor(model: string): { input: number; output: number } | undefined {
  return PRICING[model] ?? PRICING[normalizeModelId(model)];
}

/** Estimate USD cost for a known model. Returns undefined rather than fabricating a price. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const rate = rateFor(model);
  if (!rate) return undefined;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/**
 * A blended USD/1M-token estimate used only to order fallback candidates. The
 * `ref` may carry a `provider:` prefix, which is stripped before lookup.
 * Returns undefined for models with no known price (sorted last by the caller).
 */
export function blendedPrice(ref: string, defaultProvider: string): number | undefined {
  const { model } = parseModelRef(ref, defaultProvider);
  const rate = rateFor(model);
  if (!rate) return undefined;
  return (rate.input + rate.output) / 2;
}
