import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAICompatibleProvider } from "./openai.js";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("OpenAICompatibleProvider", () => {
  it("POSTs to <baseUrl>/chat/completions and parses content + usage", async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 7, completion_tokens: 11 },
      }),
    );

    const provider = new OpenAICompatibleProvider({
      apiKey: "k",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    const result = await provider.complete({ model: "x/y", prompt: "hi", params: { max_tokens: 100 } });

    expect(result.text).toBe("hello");
    expect(result.usage).toEqual({ input: 7, output: 11 });
    expect(result.costUsd).toBeUndefined(); // cost varies by endpoint — never fabricated

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "x/y",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
    });
    expect(init.headers).toMatchObject({ authorization: "Bearer k" });
  });

  it("defaults the base URL and max_tokens", async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: "x" } }], usage: {} }));
    const provider = new OpenAICompatibleProvider({ apiKey: "k" });
    await provider.complete({ model: "m", prompt: "p", params: {} });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(init.body as string).max_tokens).toBe(16_000);
  });

  it("throws on a non-2xx response, including the body", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "invalid key",
      json: async () => ({}),
    });
    const provider = new OpenAICompatibleProvider({ apiKey: "bad" });
    await expect(provider.complete({ model: "m", prompt: "p", params: {} })).rejects.toThrow(
      /401.*invalid key/,
    );
  });
});
