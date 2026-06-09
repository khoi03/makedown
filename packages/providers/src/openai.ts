/**
 * OpenAI-compatible adapter. Talks to any endpoint that implements the
 * `/chat/completions` API: OpenAI, OpenRouter, Groq, Together, Fireworks, and
 * local servers (Ollama, vLLM, LM Studio). Uses `fetch` so there's no SDK lock-in.
 *
 * Cost is endpoint/model-dependent across these providers, so it is not
 * estimated here (we never report a fabricated number).
 */
import type { CompletionRequest, CompletionResult, Provider } from "./provider.js";
import { resolveMaxTokens } from "./params.js";

export interface OpenAICompatibleConfig {
  readonly apiKey: string;
  /** Base URL ending before `/chat/completions`. Defaults to OpenAI. */
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface ChatCompletionResponse {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

export class OpenAICompatibleProvider implements Provider {
  readonly id = "openai";

  constructor(private readonly config: OpenAICompatibleConfig) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const base = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: "user", content: request.prompt }],
        max_tokens: resolveMaxTokens(request.params),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `OpenAI-compatible request failed (${response.status} ${response.statusText}): ${detail}`,
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
    };
    return { text, usage };
  }
}
