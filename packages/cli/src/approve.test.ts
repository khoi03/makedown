import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import type { ApprovalRequest } from "@makedown/engine";
import { parseApproval, renderApprovalPrompt, createInteractiveApprover } from "./approve.js";
import { makeStyler } from "./format.js";

const plain = makeStyler(false);

const REQ: ApprovalRequest = {
  target: "refactor",
  id: "sha256:x",
  output: "artifacts/refactor.diff",
  preview: "diff --git a/x b/x\n+hello",
  step: "agent",
};

/** A duplex pair that looks like an interactive terminal to readline. */
function fakeTTY(): { input: NodeJS.ReadStream; output: NodeJS.WriteStream } {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  (input as unknown as { isTTY: boolean }).isTTY = true;
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  (output as unknown as { isTTY: boolean }).isTTY = true;
  return { input, output };
}

describe("parseApproval", () => {
  it.each(["y", "Y", "yes", "YES", " y "])("approves on %j", (a) => {
    expect(parseApproval(a)).toBe(true);
  });
  it.each(["n", "no", "", "maybe", "yep", "nope"])("denies on %j", (a) => {
    expect(parseApproval(a)).toBe(false);
  });
});

describe("renderApprovalPrompt", () => {
  it("shows the target, output path, and preview", () => {
    const out = renderApprovalPrompt(REQ, plain);
    expect(out).toContain("refactor");
    expect(out).toContain("artifacts/refactor.diff");
    expect(out).toContain("+hello");
  });

  it("truncates a very long preview", () => {
    const out = renderApprovalPrompt({ ...REQ, preview: "x".repeat(5000) }, plain);
    expect(out).toContain("more chars");
  });
});

describe("createInteractiveApprover", () => {
  it("denies by default when there is no interactive terminal", async () => {
    const input = { isTTY: false } as unknown as NodeJS.ReadStream;
    const approve = createInteractiveApprover(input, process.stdout);
    expect(await approve(REQ)).toBe(false);
  });

  it("approves when the TTY answers yes", async () => {
    const { input, output } = fakeTTY();
    const approve = createInteractiveApprover(input, output);
    const decision = approve(REQ);
    (input as unknown as PassThrough).write("y\n");
    expect(await decision).toBe(true);
  });

  it("denies when the TTY answers with an empty line", async () => {
    const { input, output } = fakeTTY();
    const approve = createInteractiveApprover(input, output);
    const decision = approve(REQ);
    (input as unknown as PassThrough).write("\n");
    expect(await decision).toBe(false);
  });
});
