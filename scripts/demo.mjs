#!/usr/bin/env node
/**
 * Scripted README walkthrough for the flagship `examples/showcase` workspace.
 *
 * Runs the **key-free** slice of the demo end to end against the real `md` CLI —
 * planning (`status`/`graph`/`cost`/`why`) plus the deterministic `extract` build
 * — and prints each step so a reader can follow along. The model steps (`summary`,
 * `share`) are listed but not run; they need a credential and are left to the
 * reader. This keeps the demo reproducible with no keys and no spend.
 *
 * Usage:  pnpm build && node scripts/demo.mjs
 * (Build `extract` also needs MarkItDown; if it is missing the step is skipped
 *  with a hint rather than failing the run.)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The showcase workspace, relative to the repo root (where this script runs). */
export const SHOWCASE_DIR = "examples/showcase";

/**
 * The guided walkthrough — the single source of truth the README mirrors. Each
 * step is one `md` invocation; `keyFree` steps run with no credential.
 *
 * @typedef {{ title: string, argv: string[], keyFree: boolean,
 *             needsMarkitdown?: boolean, note?: string }} DemoStep
 * @type {DemoStep[]}
 */
export const DEMO_STEPS = [
  {
    title: "What's stale, and why",
    argv: ["status", SHOWCASE_DIR],
    keyFree: true,
  },
  {
    title: "The dependency graph, in execution order",
    argv: ["graph", SHOWCASE_DIR],
    keyFree: true,
  },
  {
    title: "Estimate the cost (dry run, no model calls)",
    argv: ["cost", SHOWCASE_DIR],
    keyFree: true,
  },
  {
    title: "Build the deterministic part — auto-import + transform, zero tokens",
    argv: ["build", SHOWCASE_DIR],
    keyFree: true,
    needsMarkitdown: true,
    note: "Builds `extract`; the model steps are deferred until you add a key.",
  },
  {
    title: "Full provenance for the extract artifact",
    argv: ["why", "extract", SHOWCASE_DIR],
    keyFree: true,
  },
  {
    title: "Go live: run the cost-aware chat summary (needs a key)",
    argv: ["build", SHOWCASE_DIR],
    keyFree: false,
    note: "Set ANTHROPIC_API_KEY in examples/showcase/.env first.",
  },
  {
    title: "Export the summary as a shareable, self-contained artifact",
    argv: ["share", "summary", SHOWCASE_DIR, "--provenance"],
    keyFree: false,
  },
];

/** The planning/deterministic steps that run with no credential. */
export function keyFreeSteps(steps = DEMO_STEPS) {
  return steps.filter((s) => s.keyFree);
}

/** The model steps that require a credential (listed, not run). */
export function liveSteps(steps = DEMO_STEPS) {
  return steps.filter((s) => !s.keyFree);
}

/** Absolute path to the built CLI entry (`packages/cli/dist/index.js`). */
export function cliEntry() {
  return join(ROOT, "packages", "cli", "dist", "index.js");
}

/** Whether MarkItDown is reachable (PATH command or MAKEDOWN_MARKITDOWN_CMD). */
export function markitdownAvailable() {
  return Boolean(process.env["MAKEDOWN_MARKITDOWN_CMD"]);
}

/**
 * Run one demo step against the real CLI. Resolves with the exit code and
 * captured output rather than throwing, so the caller decides how to narrate it.
 *
 * @param {DemoStep} step
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runStep(step) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [cliEntry(), ...step.argv], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolvePromise({ code: code ?? 0, stdout, stderr }));
  });
}

const BAR = "─".repeat(72);

async function main() {
  if (!existsSync(cliEntry())) {
    console.error("CLI not built. Run `pnpm build` first, then `node scripts/demo.mjs`.");
    process.exitCode = 1;
    return;
  }

  console.log(`\nMakedown guided demo — ${SHOWCASE_DIR}\n${BAR}`);

  for (const step of keyFreeSteps()) {
    console.log(`\n▶ ${step.title}`);
    console.log(`  $ md ${step.argv.join(" ")}\n`);

    if (step.needsMarkitdown && !markitdownAvailable()) {
      console.log("  (skipped — MarkItDown not detected. `pip install 'markitdown[all]'`");
      console.log("   or set MAKEDOWN_MARKITDOWN_CMD, then re-run to build `extract`.)");
      continue;
    }

    const { code, stdout, stderr } = await runStep(step);
    if (stdout.trim()) console.log(indent(stdout.trim()));
    // `build` exits non-zero only because the model steps are *deferred*, which is
    // expected in the key-free demo — surface that note without failing the run.
    if (code !== 0 && stderr.trim()) console.log(indent(stderr.trim()));
  }

  console.log(`\n${BAR}\nNext — go live (needs a key in ${SHOWCASE_DIR}/.env):\n`);
  for (const step of liveSteps()) {
    console.log(`  $ md ${step.argv.join(" ")}`);
    if (step.note) console.log(`      ${step.note}`);
  }
  console.log("");
}

function indent(text) {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
