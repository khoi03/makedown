import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
// @ts-expect-error — plain ESM dev script, no type declarations.
import {
  DEMO_STEPS,
  SHOWCASE_DIR,
  keyFreeSteps,
  liveSteps,
  cliEntry,
  runStep,
} from "./demo.mjs";

/**
 * `scripts/demo.mjs` is the scripted README walkthrough. DEMO_STEPS is its single
 * source of truth (the README mirrors it), so these tests guard the walkthrough
 * against drift, and run the key-free planning slice against the real CLI when it
 * is built (`md status` needs neither a key nor MarkItDown).
 */
describe("demo walkthrough definition", () => {
  it("every step has a title and targets the showcase workspace", () => {
    expect(DEMO_STEPS.length).toBeGreaterThan(0);
    for (const step of DEMO_STEPS) {
      expect(step.title).toBeTruthy();
      expect(Array.isArray(step.argv)).toBe(true);
      expect(step.argv.length).toBeGreaterThan(0);
      expect(step.argv).toContain(SHOWCASE_DIR);
    }
  });

  it("covers the planning commands key-free", () => {
    const commands = keyFreeSteps().map((s) => s.argv[0]);
    expect(commands).toContain("status");
    expect(commands).toContain("graph");
    expect(commands).toContain("cost");
    expect(commands).toContain("why");
  });

  it("marks the model steps as not key-free", () => {
    const live = liveSteps().map((s) => s.argv[0]);
    expect(live).toContain("share");
    expect(keyFreeSteps().every((s) => s.keyFree)).toBe(true);
    expect(liveSteps().every((s) => !s.keyFree)).toBe(true);
  });

  it("partitions every step into exactly one of key-free / live", () => {
    expect(keyFreeSteps().length + liveSteps().length).toBe(DEMO_STEPS.length);
  });
});

describe("demo runner (integration, needs built CLI)", () => {
  const built = existsSync(cliEntry());

  it.skipIf(!built)("runs `md status` against the showcase with exit 0", async () => {
    const result = await runStep(
      { title: "status", argv: ["status", SHOWCASE_DIR], keyFree: true },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("extract");
  });
});
