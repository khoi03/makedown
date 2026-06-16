/**
 * Anthropic adapter.
 *
 * Note on params: current Opus models (4.8/4.7) reject `temperature`, `top_p`,
 * `top_k`, and `budget_tokens` — sending them returns a 400. So this adapter
 * does NOT forward the recipe's `params` verbatim. Those values still belong in
 * `build.md` (they participate in a target's identity hash and document intent),
 * but only the parameters the API accepts are sent here. See SPEC.md §7.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResult, Provider } from "./provider.js";
import { resolveMaxTokens } from "./params.js";
import { ProviderError, kindFromStatus, parseRetryAfter } from "./errors.js";
import { estimateCostUsd, normalizeModelId } from "./pricing.js";

// Re-exported for back-compat: pricing now lives in pricing.ts (shared with the
// cost-aware fallback ordering), but these were originally exported from here.
export { estimateCostUsd, normalizeModelId };

/** Pull a `Retry-After` hint (ms) off an SDK error's headers, if present. */
function retryAfterOf(err: unknown): number | undefined {
  const headers = (err as { headers?: unknown })?.headers;
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    return parseRetryAfter(headers as { get(name: string): string | null });
  }
  return undefined;
}

/** Translate an Anthropic SDK / network failure into a classified ProviderError. */
function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") {
    return new ProviderError(messageOf(err, `Anthropic request failed (${status})`), kindFromStatus(status), "anthropic", status, { cause: err, retryAfterMs: retryAfterOf(err) });
  }
  // Connection/timeout/abort errors carry no status — treat as a transient timeout.
  const name = (err as { name?: unknown })?.name;
  if (typeof name === "string" && /connection|timeout|abort/i.test(name)) {
    return new ProviderError(messageOf(err, "Anthropic connection error"), "timeout", "anthropic", undefined, { cause: err });
  }
  return new ProviderError(messageOf(err, "Anthropic request failed"), "unknown", "anthropic", undefined, { cause: err });
}

function messageOf(err: unknown, fallback: string): string {
  const m = (err as { message?: unknown })?.message;
  return typeof m === "string" && m.length > 0 ? m : fallback;
}

export interface AnthropicConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(config: AnthropicConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
  }

  private async send(request: CompletionRequest) {
    try {
      return await this.client.messages.create({
        model: request.model,
        max_tokens: resolveMaxTokens(request.params),
        ...(request.system ? { system: request.system } : {}),
        messages: [{ role: "user", content: request.prompt }],
      });
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const message = await this.send(request);

    let text = "";
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
    }

    const usage = {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
    };
    return {
      text,
      usage,
      costUsd: estimateCostUsd(request.model, usage.input, usage.output),
      model: request.model,
    };
  }
}
