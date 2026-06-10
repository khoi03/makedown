import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdInit, cmdStatus, cmdGraph, cmdCost, cmdRender, cmdWhy, cmdBuild } from "./commands.js";

let dir: string;
let logs: string[];
let errors: string[];
let savedKeys: Record<string, string | undefined>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "makedown-cli-"));
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
  // Make provider detection deterministic and prevent any real API call.
  savedKeys = {
    ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"],
    OPENAI_API_KEY: process.env["OPENAI_API_KEY"],
  };
  delete process.env["ANTHROPIC_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  process.exitCode = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedKeys)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.exitCode = 0;
  await rm(dir, { recursive: true, force: true });
});

describe("cmd* handlers", () => {
  it("init scaffolds a workspace that status can read", async () => {
    await cmdInit(dir);
    expect(await readFile(join(dir, "build.md"), "utf8")).toContain("target: summary");

    await cmdStatus(dir);
    const out = logs.join("\n");
    expect(out).toContain("summary");
    expect(out).toContain("stale");
  });

  it("graph prints the execution order", async () => {
    await cmdInit(dir);
    logs.length = 0;
    await cmdGraph(dir);
    expect(logs.join("\n")).toContain("summary");
  });

  it("cost prints an upper-bound estimate", async () => {
    await cmdInit(dir);
    logs.length = 0;
    await cmdCost(dir);
    expect(logs.join("\n")).toContain("Estimated upper bound");
  });

  it("render prints the interpolated prompt without a model call", async () => {
    await cmdInit(dir);
    logs.length = 0;
    await cmdRender("summary", dir);
    expect(logs.join("\n")).toContain("Summarize");
  });

  it("why reports missing provenance before a build", async () => {
    await cmdInit(dir);
    logs.length = 0;
    await cmdWhy("summary", dir);
    expect(logs.join("\n")).toContain("no provenance yet");
  });

  it("why errors on an unknown target", async () => {
    await cmdInit(dir);
    await cmdWhy("does-not-exist", dir);
    expect(errors.join("\n")).toContain("Unknown target");
    expect(process.exitCode).toBe(1);
  });

  it("defers model steps when no provider is configured", async () => {
    await cmdInit(dir); // scaffold is a single chat target
    await cmdBuild(dir);
    expect(errors.join("\n")).toMatch(/Deferred .* model provider/);
    expect(process.exitCode).toBe(1);
  });

  it("builds provider-free transform targets and defers the model ones", async () => {
    await mkdir(join(dir, "sources"), { recursive: true });
    await mkdir(join(dir, "transforms"), { recursive: true });
    await writeFile(join(dir, "sources", "in.md"), "hello", "utf8");
    await writeFile(
      join(dir, "transforms", "up.mjs"),
      `export default (i) => i["sources/in.md"].toUpperCase();`,
      "utf8",
    );
    await writeFile(
      join(dir, "build.md"),
      `## target: shout
\`\`\`yaml
inputs: [sources/in.md]
step: transform
transform: transforms/up.mjs
output: artifacts/shout.md
\`\`\`

## target: summary
\`\`\`yaml
inputs: [sources/in.md]
step: chat
model: claude-opus-4-8
output: artifacts/summary.md
\`\`\`
Summarize {{sources/in.md}}.
`,
      "utf8",
    );

    await cmdBuild(dir);

    // The transform built with no key...
    expect(await readFile(join(dir, "artifacts", "shout.md"), "utf8")).toBe("HELLO");
    expect(logs.join("\n")).toContain("shout");
    // ...and the model target was deferred.
    expect(errors.join("\n")).toContain("summary");
    expect(process.exitCode).toBe(1);
  });
});
