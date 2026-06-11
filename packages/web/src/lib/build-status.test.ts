import { describe, it, expect } from "vitest";
import { reduceBuildStatuses, applyEvent } from "./build-status.js";
import type { BuildStreamEvent } from "./types.js";

describe("reduceBuildStatuses", () => {
  it("returns an empty map for no events", () => {
    expect(reduceBuildStatuses([])).toEqual({});
  });

  it("marks a target building on start and built on completion", () => {
    const events: BuildStreamEvent[] = [
      { type: "progress", event: { type: "target-start", target: "t", stale: true } },
      { type: "progress", event: { type: "target-built", target: "t" } },
    ];
    expect(reduceBuildStatuses(events)).toEqual({ t: "built" });
  });

  it("tracks reused, denied, and skipped outcomes", () => {
    const events: BuildStreamEvent[] = [
      { type: "progress", event: { type: "target-reused", target: "a" } },
      { type: "progress", event: { type: "target-denied", target: "b" } },
      { type: "progress", event: { type: "target-skipped", target: "c" } },
    ];
    expect(reduceBuildStatuses(events)).toEqual({ a: "reused", b: "denied", c: "skipped" });
  });

  it("applyEvent immutably updates a status map", () => {
    const before = { a: "building" as const };
    const after = applyEvent(before, { type: "progress", event: { type: "target-built", target: "a" } });
    expect(after).toEqual({ a: "built" });
    expect(before).toEqual({ a: "building" }); // unchanged
  });

  it("ignores non-progress stream events", () => {
    const after = applyEvent({}, { type: "done", built: ["x"], reused: [], rejected: [] });
    expect(after).toEqual({});
  });
});
