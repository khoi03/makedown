/**
 * Provider router. Dispatches each request to the right backend based on the
 * target's `model` string, so a single workspace can mix and compare models
 * from different vendors. The router itself implements `Provider`, so the engine
 * stays provider-agnostic.
 *
 * Model syntax: `provider:model` (e.g. `openai:gpt-5`, `anthropic:claude-opus-4-8`).
 * A bare model with no known prefix uses `defaultProvider`.
 *
 * Fallback: when a request carries a `fallback` chain, the router tries each
 * candidate in turn, advancing on transient failures (see fallback.ts). The
 * model that actually produced the result is reported on `CompletionResult.model`
 * (the full `provider:model` ref) so provenance stays honest.
 */
import type { Provider } from "./provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { ProviderError } from "./errors.js";
import { buildChain, runWithFallback } from "./fallback.js";
import type { RetryPolicy } from "./retry.js";
import { KNOWN_PROVIDERS, parseModelRef, type ModelRef } from "./model-ref.js";

export { parseModelRef, type ModelRef };

export interface ProviderRouterConfig {
  /** Provider for bare model names (no `provider:` prefix). Default: "anthropic". */
  readonly defaultProvider?: string;
  readonly anthropic?: { readonly apiKey: string; readonly baseUrl?: string };
  readonly openai?: { readonly apiKey: string; readonly baseUrl?: string };
  /** Per-model retry/backoff overrides (merged over the defaults). */
  readonly retry?: Partial<RetryPolicy>;
}

/** A Provider that routes each request to the configured backend for its model. */
export function createProviderRouter(config: ProviderRouterConfig): Provider {
  const defaultProvider = config.defaultProvider ?? "anthropic";
  const cache = new Map<string, Provider>();

  const get = (id: string): Provider => {
    const existing = cache.get(id);
    if (existing) return existing;

    let provider: Provider;
    if (id === "anthropic") {
      if (!config.anthropic) {
        // Classified as "unavailable" (retryable) so a fallback chain can skip an
        // unconfigured provider instead of aborting the whole build.
        throw new ProviderError(
          'Provider "anthropic" is not configured — set ANTHROPIC_API_KEY',
          "unavailable",
          "anthropic",
        );
      }
      provider = new AnthropicProvider(config.anthropic);
    } else if (id === "openai") {
      if (!config.openai) {
        throw new ProviderError(
          'Provider "openai" is not configured — set OPENAI_API_KEY',
          "unavailable",
          "openai",
        );
      }
      provider = new OpenAICompatibleProvider(config.openai);
    } else {
      throw new ProviderError(
        `Unknown provider "${id}" (known: ${KNOWN_PROVIDERS.join(", ")})`,
        "bad_request",
        id,
      );
    }
    cache.set(id, provider);
    return provider;
  };

  return {
    id: "router",
    async complete(request) {
      if (!request.model.trim()) {
        throw new Error("No model specified for a target — set `model:` in build.md");
      }
      const chain = buildChain(request.model, request.fallback, request.route, defaultProvider);
      return runWithFallback(
        chain,
        async (ref) => {
          const { provider, model } = parseModelRef(ref, defaultProvider);
          const result = await get(provider).complete({
            ...request,
            model,
            fallback: undefined,
            route: undefined,
          });
          // Stamp the full `provider:model` ref as the producer, matching how the
          // recipe expressed it — keeps provenance + analytics keys consistent.
          return { ...result, model: ref };
        },
        { retry: config.retry },
      );
    },
  };
}
