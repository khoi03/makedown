/**
 * Model-reference parsing, shared by the router and the pricing/cost-aware
 * ordering. Lives in its own module so `pricing.ts` can resolve a `provider:model`
 * ref without importing `router.ts` (which would create an import cycle).
 *
 * Model syntax: `provider:model` (e.g. `openai:gpt-5`, `anthropic:claude-opus-4-8`).
 * A bare model with no known prefix uses `defaultProvider`.
 */

export const KNOWN_PROVIDERS = ["anthropic", "openai"] as const;

export interface ModelRef {
  readonly provider: string;
  readonly model: string;
}

/** Parse `provider:model`; bare strings (or unknown prefixes) use `defaultProvider`. */
export function parseModelRef(raw: string, defaultProvider: string): ModelRef {
  const idx = raw.indexOf(":");
  if (idx > 0) {
    const prefix = raw.slice(0, idx);
    if ((KNOWN_PROVIDERS as readonly string[]).includes(prefix)) {
      return { provider: prefix, model: raw.slice(idx + 1) };
    }
  }
  return { provider: defaultProvider, model: raw };
}
