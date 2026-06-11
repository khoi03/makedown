import { describe, it, expect } from "vitest";
import type { BuildPlan, BuildResult, BuildCost, TargetPlan } from "@makedown/engine";
import type { TargetBlock } from "@makedown/shared";
import { makeStyler } from "./format.js";
import { renderStatus, renderGraph, renderBuildResult, renderCost, renderWhy } from "./render.js";

const plain = makeStyler(false); // deterministic, no ANSI

function target(name: string): TargetBlock {
  return {
    name,
    header: {
      inputs: [],
      step: "chat",
      params: {},
      output: `artifacts/${name}.md`,
      cache: { kind: "deterministic" },
      sandbox: "worktree",
      approval: "none",
    },
    body: "",
  };
}

function plan(targets: { name: string; stale: boolean; deps?: string[] }[]): BuildPlan {
  const order = targets.map((t) => t.name);
  const nodes = new Map(
    targets.map((t) => [
      t.name,
      { target: target(t.name), deps: t.deps ?? [], sources: [] as string[] },
    ]),
  );
  const tps: TargetPlan[] = targets.map((t) => ({
    name: t.name,
    id: `sha256:${t.name}`,
    stale: t.stale,
    inputs: [],
  }));
  return { graph: { nodes, order }, targets: tps, ids: new Map() };
}

describe("renderStatus", () => {
  it("shows fresh/stale badges, deps, and a summary", () => {
    const out = renderStatus(
      plan([
        { name: "summary", stale: true },
        { name: "checklist", stale: false, deps: ["summary"] },
      ]),
      plain,
    );
    expect(out).toContain("summary");
    expect(out).toContain("stale");
    expect(out).toContain("fresh");
    expect(out).toContain("checklist");
    expect(out).toContain("1 stale");
  });

  it("handles an empty workspace", () => {
    expect(renderStatus(plan([]), plain)).toBe("No targets defined.");
  });
});

describe("renderGraph", () => {
  it("lists execution order with dependency arrows", () => {
    const out = renderGraph(plan([{ name: "a", stale: true }, { name: "b", stale: true, deps: ["a"] }]), plain);
    expect(out).toContain("a");
    expect(out).toContain("← a");
  });
});

describe("renderBuildResult", () => {
  it("marks built and reused targets", () => {
    const result: BuildResult = {
      plan: plan([{ name: "a", stale: true }, { name: "b", stale: false }]),
      built: ["a"],
      reused: ["b"],
      rejected: [],
    };
    const out = renderBuildResult(result, plain);
    expect(out).toContain("built");
    expect(out).toContain("reused");
    expect(out).toContain("1 built");
  });

  it("marks rejected targets (denied agent output) and counts them", () => {
    const result: BuildResult = {
      plan: plan([{ name: "refactor", stale: true }, { name: "summary", stale: true, deps: ["refactor"] }]),
      built: [],
      reused: [],
      rejected: ["refactor", "summary"],
    };
    const out = renderBuildResult(result, plain);
    expect(out).toContain("✗ rejected");
    expect(out).toContain("2 rejected");
  });
});

describe("renderCost", () => {
  it("renders a table with an upper-bound total", () => {
    const cost: BuildCost = {
      targets: [
        {
          target: "summary",
          step: "chat",
          model: "claude-opus-4-8",
          stale: true,
          calls: 1,
          inputTokens: 1200,
          maxOutputTokens: 1000,
          costUsd: 0.031,
        },
      ],
      totalCostUsd: 0.031,
      hasUnpriced: false,
    };
    const out = renderCost(cost, plain);
    expect(out).toContain("summary");
    expect(out).toContain("Estimated upper bound");
    expect(out).toContain("$0.03");
  });

  it("warns when a model is unpriced", () => {
    const cost: BuildCost = {
      targets: [
        {
          target: "t",
          step: "chat",
          model: "openai:mystery",
          stale: true,
          calls: 1,
          inputTokens: 10,
          maxOutputTokens: 100,
          costUsd: undefined,
        },
      ],
      totalCostUsd: 0,
      hasUnpriced: true,
    };
    expect(renderCost(cost, plain)).toContain("no known pricing");
  });
});

describe("renderWhy", () => {
  it("shows provenance when present", () => {
    const out = renderWhy(
      {
        name: "summary",
        id: "sha256:abc123",
        stale: false,
        step: "chat",
        cache: "deterministic",
        inputs: [{ ref: "sources/notes.md", kind: "source", hash: "sha256:deadbeef0000" }],
        provenance: {
          target: "summary",
          id: "sha256:abc123",
          output: "artifacts/summary.md",
          step: "chat",
          model: "claude-opus-4-8",
          params: {},
          inputs: [],
          promptHash: "sha256:p",
          tokens: { input: 100, output: 50 },
          costUsd: 0.02,
          producedAt: "2026-06-09T00:00:00.000Z",
        },
      },
      plain,
    );
    expect(out).toContain("claude-opus-4-8");
    expect(out).toContain("in 100 / out 50");
    expect(out).toContain("sources/notes.md");
  });

  it("notes missing provenance and shows sample counts", () => {
    const out = renderWhy(
      {
        name: "ideas",
        id: "sha256:xyz",
        stale: true,
        step: "chat",
        cache: "stochastic(n=3)",
        inputs: [],
        samples: { have: 1, want: 3 },
      },
      plain,
    );
    expect(out).toContain("1/3 samples");
    expect(out).toContain("no provenance yet");
  });
});
