import { describe, it, expect } from "vitest";
import { parseModelRef, createProviderRouter } from "./router.js";

describe("parseModelRef", () => {
  it("defaults a bare model to the default provider", () => {
    expect(parseModelRef("claude-opus-4-8", "anthropic")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-8",
    });
  });

  it("splits a known provider prefix", () => {
    expect(parseModelRef("openai:gpt-5", "anthropic")).toEqual({
      provider: "openai",
      model: "gpt-5",
    });
  });

  it("keeps slashes in the model id (e.g. OpenRouter ids)", () => {
    expect(parseModelRef("openai:meta-llama/llama-3.3-70b", "anthropic")).toEqual({
      provider: "openai",
      model: "meta-llama/llama-3.3-70b",
    });
  });

  it("treats an unknown prefix as part of the model (no false split)", () => {
    expect(parseModelRef("gpt-4:latest", "anthropic")).toEqual({
      provider: "anthropic",
      model: "gpt-4:latest",
    });
  });
});

describe("createProviderRouter", () => {
  it("errors clearly when the target's provider is not configured", async () => {
    const router = createProviderRouter({ defaultProvider: "anthropic" }); // no keys
    await expect(
      router.complete({ model: "openai:gpt-5", prompt: "x", params: {} }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("errors when a target has no model", async () => {
    const router = createProviderRouter({});
    await expect(router.complete({ model: "   ", prompt: "x", params: {} })).rejects.toThrow(
      /No model/,
    );
  });
});
