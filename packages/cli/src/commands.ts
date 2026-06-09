/** Implementations behind the `md` subcommands. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planBuild, runBuild, renderTarget, estimateBuildCost } from "@makedown/engine";
import { cachePolicyToString } from "@makedown/shared";
import { loadDoc, makeContext, resolveDir, hasAnyProvider, BUILD_FILE } from "./workspace.js";
import { loadEnv } from "./env.js";
import { colorEnabled, makeStyler } from "./format.js";
import { renderStatus, renderGraph, renderBuildResult, renderCost, renderWhy } from "./render.js";

const styler = makeStyler(colorEnabled());

export async function cmdStatus(dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);
  const plan = await planBuild(doc, makeContext(dir));
  console.log(renderStatus(plan, styler));
}

export async function cmdBuild(dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);

  // Only model steps need a provider; a transform-only build runs without one.
  const plan = await planBuild(doc, makeContext(dir));
  const byName = new Map(doc.targets.map((t) => [t.name, t] as const));
  const needsProvider = plan.targets.some(
    (tp) => tp.stale && byName.get(tp.name)?.header.step !== "transform",
  );

  if (needsProvider && !hasAnyProvider()) {
    console.error(styler.red("No model provider configured — required to run model steps."));
    console.error("Create a .env in the workspace (see .env.example) with ANTHROPIC_API_KEY");
    console.error("and/or OPENAI_API_KEY, or use `md status` / `md graph` to inspect without building.");
    process.exitCode = 1;
    return;
  }

  const result = await runBuild(doc, makeContext(dir, hasAnyProvider()));
  console.log(renderBuildResult(result, styler));
}

export async function cmdGraph(dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);
  const plan = await planBuild(doc, makeContext(dir));
  console.log(renderGraph(plan, styler));
}

export async function cmdWhy(name: string, dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);
  const ctx = makeContext(dir);
  const plan = await planBuild(doc, ctx);
  const tp = plan.targets.find((t) => t.name === name);
  if (!tp) {
    console.error(styler.red(`Unknown target: ${name}`));
    process.exitCode = 1;
    return;
  }
  const target = doc.targets.find((t) => t.name === name)!;
  const provenance = await ctx.cas.getProvenance(tp.id);
  const cache = target.header.cache;
  const samples =
    cache.kind === "stochastic"
      ? { have: await ctx.cas.countSamples(tp.id), want: cache.n }
      : undefined;

  console.log(
    renderWhy(
      {
        name,
        id: tp.id,
        stale: tp.stale,
        step: target.header.step,
        cache: cachePolicyToString(cache),
        inputs: tp.inputs,
        samples,
        provenance,
      },
      styler,
    ),
  );
}

export async function cmdRender(name: string, dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);
  const { system, prompt } = await renderTarget(doc, name, makeContext(dir));

  if (system !== undefined) {
    console.log(styler.dim("─── system ───"));
    console.log(system);
    console.log("");
  }
  console.log(styler.dim("─── prompt (user) ───"));
  console.log(prompt);

  const total = (system?.length ?? 0) + prompt.length;
  console.log(styler.dim(`\n(${total} characters across system + prompt; no tokens spent)`));
}

export async function cmdCost(dirArg?: string): Promise<void> {
  const dir = resolveDir(dirArg);
  loadEnv(dir);
  const doc = await loadDoc(dir);
  const cost = await estimateBuildCost(doc, makeContext(dir));
  console.log(renderCost(cost, styler));
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
  console.log(styler.green(`Initialized Makedown workspace in ${dir}`));
  console.log(styler.dim("Next: `md status`  (set ANTHROPIC_API_KEY, then `md build`)"));
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
