/**
 * Model pricing — the single home for the confirmed USD rate table. Used both to
 * estimate a completed call's cost (feeds provenance + `md cost`) and to order
 * fallback candidates cheapest-first under `route: cost-aware`. Pure data + pure
 * functions: no network, no SDK, so it stays Apache-2.0 framework-side.
 */
import { parseModelRef } from "./model-ref.js";

type Rate = { input: number; output: number };

/**
 * Authoritative USD per 1M tokens, keyed by the bare Anthropic model id.
 * Confirmed (cached 2026-05-26). This table backs `estimateCostUsd`, which feeds
 * provenance + `md cost`, so it stays Anthropic-only — we never report a
 * fabricated cost for OpenAI-compatible endpoints (their price varies per host).
 */
const PRICING: Readonly<Record<string, Rate>> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * Public list prices for common OpenAI models, used **only** to order
 * cost-aware fallback candidates — never to report a cost. Actual spend on an
 * OpenAI-compatible endpoint (OpenRouter, Groq, …) may differ, so these don't
 * feed `estimateCostUsd`. Unknown models stay unpriced (sorted last). Extend as
 * needed; provide a confirmed rate to add a model.
 */
const OPENAI_ORDERING_PRICING: Readonly<Record<string, Rate>> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/** Strip a trailing `-YYYYMMDD` model-snapshot suffix (e.g. `claude-haiku-4-5-20251001`). */
const DATE_SUFFIX_RE = /-\d{8}$/;

/**
 * Reduce a possibly-prefixed Anthropic model id to the bare id used as a pricing key:
 * - strips a gateway path prefix:  `cc/claude-sonnet-4-6` -> `claude-sonnet-4-6`
 * - strips a Bedrock vendor dot:   `anthropic.claude-opus-4-8` -> `claude-opus-4-8`
 */
export function normalizeModelId(model: string): string {
  const lastSlash = model.lastIndexOf("/");
  let id = lastSlash === -1 ? model : model.slice(lastSlash + 1);
  if (id.startsWith("anthropic.")) id = id.slice("anthropic.".length);
  return id;
}

/** Resolve a rate from a table, trying the id verbatim then with a dated snapshot suffix stripped. */
function lookup(table: Readonly<Record<string, Rate>>, id: string): Rate | undefined {
  return table[id] ?? table[id.replace(DATE_SUFFIX_RE, "")];
}

/** Anthropic rate for a (possibly prefixed/dated) model id. */
function anthropicRate(model: string): Rate | undefined {
  return lookup(PRICING, model) ?? lookup(PRICING, normalizeModelId(model));
}

/** Estimate USD cost for a known Anthropic model. Returns undefined rather than fabricating a price. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const rate = anthropicRate(model);
  if (!rate) return undefined;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/**
 * A blended USD/1M-token estimate used only to order fallback candidates. The
 * `ref` may carry a `provider:` prefix selecting which ordering table to use.
 * Returns undefined for models with no known price (sorted last by the caller).
 */
export function blendedPrice(ref: string, defaultProvider: string): number | undefined {
  const { provider, model } = parseModelRef(ref, defaultProvider);
  const rate =
    provider === "openai" ? lookup(OPENAI_ORDERING_PRICING, model) : anthropicRate(model);
  if (!rate) return undefined;
  return (rate.input + rate.output) / 2;
}
