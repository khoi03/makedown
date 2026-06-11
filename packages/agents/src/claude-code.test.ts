import { describe, it, expect } from "vitest";
import { ClaudeCodeAgentRunner, loadAgentSdk, type AgentQuery } from "./claude-code.js";

/** Build a fake SDK `query` that yields the given messages and records its args. */
function fakeQuery(messages: unknown[]): { query: AgentQuery; seen: { args?: unknown } } {
  const seen: { args?: unknown } = {};
  const query: AgentQuery = (args) => {
    seen.args = args;
    return (async function* () {
      for (const m of messages) yield m as never;
    })();
  };
  return { query, seen };
}

describe("ClaudeCodeAgentRunner", () => {
  it("maps the SDK result message to an AgentRunResult", async () => {
    const { query } = fakeQuery([
      { type: "system" },
      { type: "assistant" },
      {
        type: "result",
        result: "DONE",
        total_cost_usd: 0.05,
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    ]);
    const runner = new ClaudeCodeAgentRunner(query);

    const res = await runner.run({ agent: "claude-code", prompt: "hi", params: {}, workdir: "/w" });

    expect(res.output).toBe("DONE");
    expect(res.usage).toEqual({ input: 10, output: 20 });
    expect(res.costUsd).toBe(0.05);
    expect(res.producedBy).toBe("agent:claude-code");
  });

  it("passes prompt, cwd, model, systemPrompt, and bypassPermissions to the SDK", async () => {
    const { query, seen } = fakeQuery([
      { type: "result", result: "ok", total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } },
    ]);
    const runner = new ClaudeCodeAgentRunner(query);

    await runner.run({
      agent: "claude-code",
      model: "claude-opus-4-8",
      system: "be precise",
      prompt: "go",
      params: {},
      workdir: "/w",
    });

    const args = seen.args as { prompt: string; options: Record<string, unknown> };
    expect(args.prompt).toBe("go");
    expect(args.options.cwd).toBe("/w");
    expect(args.options.model).toBe("claude-opus-4-8");
    expect(args.options.systemPrompt).toBe("be precise");
    expect(args.options.permissionMode).toBe("bypassPermissions");
  });

  it("tolerates a run that never emits a result message (empty output, zero usage)", async () => {
    const { query } = fakeQuery([{ type: "system" }, { type: "assistant" }]);
    const runner = new ClaudeCodeAgentRunner(query);
    const res = await runner.run({ agent: "claude-code", prompt: "x", params: {}, workdir: "/w" });
    expect(res.output).toBe("");
    expect(res.usage).toEqual({ input: 0, output: 0 });
  });

  it("loadAgentSdk gives an actionable install hint when the SDK is absent", async () => {
    await expect(loadAgentSdk("@makedown/definitely-not-installed-xyz")).rejects.toThrow(/install/i);
  });
});
