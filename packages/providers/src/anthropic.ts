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

export interface AnthropicConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

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

/** Estimate USD cost for a known Anthropic model. Tries the exact id, then the normalized one. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const rate = PRICING[model] ?? PRICING[normalizeModelId(model)];
  if (!rate) return undefined;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(config: AnthropicConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const message = await this.client.messages.create({
      model: request.model,
      max_tokens: resolveMaxTokens(request.params),
      ...(request.system ? { system: request.system } : {}),
      messages: [{ role: "user", content: request.prompt }],
    });

    let text = "";
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
    }

    const usage = {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
    };
    return { text, usage, costUsd: estimateCostUsd(request.model, usage.input, usage.output) };
  }
}
