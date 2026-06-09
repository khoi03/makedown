/** Implementations behind the `md` subcommands. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planBuild, runBuild } from "@makedown/engine";
import { loadDoc, makeContext, resolveDir, hasAnyProvider, BUILD_FILE } from "./workspace.js";
import { loadEnv } from "./env.js";

export async function cmdStatus(dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);
  const plan = await planBuild(doc, makeContext(dir));
  if (plan.targets.length === 0) {
    console.log("No targets defined.");
    return;
  }
  console.log("Target                         State    Depends on");
  console.log("─".repeat(60));
  for (const tp of plan.targets) {
    const node = plan.graph.nodes.get(tp.name);
    const deps = node?.deps.join(", ") || "—";
    const state = tp.stale ? "stale" : "fresh";
    console.log(`${tp.name.padEnd(30)} ${state.padEnd(8)} ${deps}`);
  }
  const stale = plan.targets.filter((t) => t.stale).length;
  console.log(`\n${stale} stale / ${plan.targets.length} total`);
}

export async function cmdBuild(dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  if (!hasAnyProvider()) {
    console.error("No model provider configured — required to run model steps.");
    console.error("Create a .env in the workspace (see .env.example) with ANTHROPIC_API_KEY");
    console.error("and/or OPENAI_API_KEY, or use `md status` / `md graph` to inspect without building.");
    process.exitCode = 1;
    return;
  }
  const doc = await loadDoc(dir);
  const result = await runBuild(doc, makeContext(dir, true));
  for (const name of result.plan.targets.map((t) => t.name)) {
    const wasBuilt = result.built.includes(name);
    console.log(`${wasBuilt ? "✓ built " : "• reused"}  ${name}`);
  }
  console.log(`\n${result.built.length} built, ${result.reused.length} reused`);
}

export async function cmdGraph(dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);
  const plan = await planBuild(doc, makeContext(dir));
  console.log("Execution order (dependencies first):\n");
  for (const name of plan.graph.order) {
    const node = plan.graph.nodes.get(name);
    const deps = node && node.deps.length ? `  ← ${node.deps.join(", ")}` : "";
    console.log(`  ${name}${deps}`);
  }
}

export async function cmdWhy(name: string, dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);
  const ctx = makeContext(dir);
  const plan = await planBuild(doc, ctx);
  const tp = plan.targets.find((t) => t.name === name);
  if (!tp) {
    console.error(`Unknown target: ${name}`);
    process.exitCode = 1;
    return;
  }
  const provenance = await ctx.cas.getProvenance(tp.id);
  console.log(`target:  ${name}`);
  console.log(`id:      ${tp.id}`);
  console.log(`state:   ${tp.stale ? "stale (not built)" : "fresh"}`);
  console.log(`inputs:`);
  for (const i of tp.inputs) {
    console.log(`  - ${i.ref} [${i.kind}] ${i.hash}`);
  }
  if (provenance) {
    console.log(`model:   ${provenance.model ?? "—"}`);
    console.log(`tokens:  in ${provenance.tokens?.input ?? "?"} / out ${provenance.tokens?.output ?? "?"}`);
    console.log(`cost:    ${provenance.costUsd !== undefined ? `$${provenance.costUsd}` : "—"}`);
    console.log(`made at: ${provenance.producedAt}`);
  } else {
    console.log("(no provenance yet — run `md build`)");
  }
}

export async function cmdCost(dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);
  const plan = await planBuild(doc, makeContext(dir));
  const stale = plan.targets.filter((t) => t.stale);
  console.log(`${stale.length} target(s) would run: ${stale.map((t) => t.name).join(", ") || "—"}`);
  console.log("Token/$ estimation is not implemented yet (Phase 1).");
}

export async function cmdInit(dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  await mkdir(join(dir, "sources"), { recursive: true });
  await writeFile(
    join(dir, "sources", "notes.md"),
    "# Notes\n\n- Example input. Edit me, then run `md status`.\n",
    "utf8",
  );
  await writeFile(join(dir, BUILD_FILE), SAMPLE_BUILD_MD, "utf8");
  console.log(`Initialized Makedown workspace in ${dir}`);
  console.log("Next: `md status`  (set ANTHROPIC_API_KEY, then `md build`)");
}

const SAMPLE_BUILD_MD = `---
defaults:
  model: claude-opus-4-8
  params: { temperature: 0, seed: 7 }
artifacts_dir: artifacts
---

# Example pipeline

## target: summary
\`\`\`yaml
inputs: [sources/notes.md]
step: chat
output: artifacts/summary.md
cache: deterministic
\`\`\`
Summarize {{sources/notes.md}} in three bullet points.
`;
