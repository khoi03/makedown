/**
 * Provider router. Dispatches each request to the right backend based on the
 * target's `model` string, so a single workspace can mix and compare models
 * from different vendors. The router itself implements `Provider`, so the engine
 * stays provider-agnostic.
 *
 * Model syntax: `provider:model` (e.g. `openai:gpt-5`, `anthropic:claude-opus-4-8`).
 * A bare model with no known prefix uses `defaultProvider`.
 */
import type { Provider } from "./provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatibleProvider } from "./openai.js";

export interface ProviderRouterConfig {
  /** Provider for bare model names (no `provider:` prefix). Default: "anthropic". */
  readonly defaultProvider?: string;
  readonly anthropic?: { readonly apiKey: string; readonly baseUrl?: string };
  readonly openai?: { readonly apiKey: string; readonly baseUrl?: string };
}

const KNOWN_PROVIDERS = ["anthropic", "openai"] as const;

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
        throw new Error('Provider "anthropic" is not configured — set ANTHROPIC_API_KEY');
      }
      provider = new AnthropicProvider(config.anthropic);
    } else if (id === "openai") {
      if (!config.openai) {
        throw new Error('Provider "openai" is not configured — set OPENAI_API_KEY');
      }
      provider = new OpenAICompatibleProvider(config.openai);
    } else {
      throw new Error(`Unknown provider "${id}" (known: ${KNOWN_PROVIDERS.join(", ")})`);
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
      const { provider, model } = parseModelRef(request.model, defaultProvider);
      return get(provider).complete({ ...request, model });
    },
  };
}
