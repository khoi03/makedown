import { describe, it, expect } from "vitest";
import { toProvenanceInput } from "./provenance-index.js";
import type { Provenance } from "@makedown/shared";

/**
 * The dual-write projects a canonical CAS provenance record into a flat index
 * row. This mapping must be lossless on the fields the index cares about and
 * tolerant of the optional ones (a transform step has no model or tokens).
 */
const base: Provenance = {
  target: "summary",
  id: "sha256:abc",
  output: "artifacts/summary.md",
  step: "chat",
  model: "claude-opus-4-8",
  params: {},
  inputs: [],
  promptHash: "sha256:p",
  tokens: { input: 120, output: 80 },
  costUsd: 0.034,
  durationMs: 1000,
  producedAt: "2026-06-12T00:00:00Z",
};

describe("toProvenanceInput", () => {
  it("maps a full chat provenance record", () => {
    expect(toProvenanceInput(base, "ws1")).toEqual({
      id: "sha256:abc",
      workspaceId: "ws1",
      target: "summary",
      step: "chat",
      model: "claude-opus-4-8",
      tokensInput: 120,
      tokensOutput: 80,
      costUsd: 0.034,
      producedAt: "2026-06-12T00:00:00Z",
    });
  });

  it("defaults missing model/tokens/cost (e.g. a zero-token transform)", () => {
    const transform: Provenance = {
      ...base,
      step: "transform",
      model: undefined,
      tokens: undefined,
      costUsd: undefined,
    };
    expect(toProvenanceInput(transform, "ws1")).toMatchObject({
      model: null,
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0,
    });
  });
});
