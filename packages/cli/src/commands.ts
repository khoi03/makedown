/** Implementations behind the `md` subcommands. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import {
  planBuild,
  runBuild,
  renderTarget,
  estimateBuildCost,
  resolveInWorkspace,
  PathEscapeError,
  type BuildPlan,
} from "@makedown/engine";
import {
  MarkItDownImporter,
  FileImportCache,
  importWithCache,
  ImporterError,
  type Importer,
} from "@makedown/import";
import { cachePolicyToString, type BuildDoc } from "@makedown/shared";
import { loadDoc, makeContext, resolveDir, hasAnyProvider, BUILD_FILE } from "./workspace.js";
import { loadEnv } from "./env.js";
import { colorEnabled, makeStyler } from "./format.js";
import { renderStatus, renderGraph, renderBuildResult, renderCost, renderWhy } from "./render.js";
import { renderShareHtml } from "./share.js";

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

  // With a provider, build everything.
  if (hasAnyProvider()) {
    const result = await runBuild(doc, makeContext(dir, true));
    console.log(renderBuildResult(result, styler));
    return;
  }

  // Without one, still build the targets that don't need a model (transforms
  // whose dependencies are also provider-free), and defer the model steps.
  const plan = await planBuild(doc, makeContext(dir));
  const free = providerFreeTargets(doc, plan);
  const buildable: BuildDoc = { ...doc, targets: doc.targets.filter((t) => free.has(t.name)) };

  if (buildable.targets.length > 0) {
    const result = await runBuild(buildable, makeContext(dir));
    console.log(renderBuildResult(result, styler));
  }

  const deferred = plan.targets.filter((tp) => tp.stale && !free.has(tp.name));
  if (deferred.length > 0) {
    console.error("");
    console.error(
      styler.yellow(
        `Deferred ${deferred.length} target(s) needing a model provider: ${deferred
          .map((tp) => tp.name)
          .join(", ")}`,
      ),
    );
    console.error(
      styler.dim(
        "Set ANTHROPIC_API_KEY / OPENAI_API_KEY in the workspace .env (see .env.example), then build again.",
      ),
    );
    process.exitCode = 1;
  }
}

/**
 * Names of targets buildable without a model provider: `transform` steps whose
 * dependencies are themselves all provider-free. Computed in execution order so
 * a transform that consumes another transform's artifact still qualifies.
 */
function providerFreeTargets(doc: BuildDoc, plan: BuildPlan): Set<string> {
  const byName = new Map(doc.targets.map((t) => [t.name, t] as const));
  const free = new Set<string>();
  for (const name of plan.graph.order) {
    const deps = plan.graph.nodes.get(name)?.deps ?? [];
    if (byName.get(name)?.header.step === "transform" && deps.every((d) => free.has(d))) {
      free.add(name);
    }
  }
  return free;
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

export interface ShareOptions {
  /** Destination file; defaults to `<artifacts>/<target>.share.html`. */
  readonly out?: string;
  /** Include provenance (model, inputs, cost) in the exported page. */
  readonly provenance?: boolean;
  readonly dir?: string;
}

/**
 * `md share <target>` — export a built artifact to a self-contained, read-only
 * HTML file (the standalone, no-server sharing path). Reads the artifact from
 * the local CAS by its current identity hash, so a stale/never-built target is
 * reported rather than silently exporting nothing.
 */
export async function cmdShare(name: string, opts: ShareOptions = {}): Promise<void> {
  const dir = resolveDir(opts.dir);
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

  const bytes = await ctx.cas.get(tp.id);
  if (!bytes) {
    console.error(styler.red(`Target "${name}" is not built yet — run \`md build\` first.`));
    process.exitCode = 1;
    return;
  }
  const content = new TextDecoder().decode(bytes);
  const provenance = opts.provenance ? await ctx.cas.getProvenance(tp.id) : undefined;

  const target = doc.targets.find((t) => t.name === name)!;
  const defaultOut = join(dir, target.header.output ? `${target.header.output}.share.html` : `${name}.share.html`);
  const outPath = opts.out ? resolve(dir, opts.out) : defaultOut;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderShareHtml({ target: name, content, provenance }), "utf8");

  console.log(styler.green(`✓ Exported ${name} → ${outPath}`));
  console.log(styler.dim("  Open it in a browser or host the file anywhere — it's fully self-contained."));
}

export interface ImportOptions {
  /** Output path (workspace-relative); defaults to `sources/<name>.md`. */
  readonly out?: string;
  readonly dir?: string;
  /** Injectable importer (tests inject a fake; default is {@link MarkItDownImporter}). */
  readonly importer?: Importer;
}

/**
 * Resolve a MarkItDown command override from the environment. Set
 * `MAKEDOWN_MARKITDOWN_CMD` when the `markitdown` shim isn't on PATH — most
 * commonly `python -m markitdown` (e.g. after a `pip install --user` on Windows,
 * where the Scripts dir is often off PATH). A multi-token value is split into an
 * argv array so nothing is shell-interpreted; an exe path with spaces should be
 * put on PATH instead.
 */
export function markitdownCommandFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | string[] | undefined {
  const raw = env["MAKEDOWN_MARKITDOWN_CMD"]?.trim();
  if (!raw) return undefined;
  const parts = raw.split(/\s+/);
  return parts.length === 1 ? parts[0] : parts;
}

/**
 * `md import <file>` — convert a non-Markdown source (PDF, DOCX, PPTX, XLSX,
 * HTML, …) to Markdown via MarkItDown and write it into the workspace, where it
 * becomes a normal hashable source referenceable as `{{sources/…}}`.
 *
 * The named input file is read as-is (an explicit user choice, like any CLI
 * argument); the output, however, is written *into* the workspace and so is
 * confined to it. The conversion is content-addressed: re-importing identical
 * bytes is served from cache with no second (potentially costly) conversion.
 */
export async function cmdImport(file: string, opts: ImportOptions = {}): Promise<void> {
  const dir = resolveDir(opts.dir);
  const inputPath = isAbsolute(file) ? file : resolve(process.cwd(), file);

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(inputPath));
  } catch {
    console.error(styler.red(`Cannot read source file: ${file}`));
    process.exitCode = 1;
    return;
  }

  const relOut = opts.out ?? join("sources", `${basename(inputPath, extname(inputPath))}.md`);
  let outPath: string;
  try {
    outPath = resolveInWorkspace(dir, relOut);
  } catch (err) {
    if (err instanceof PathEscapeError) {
      console.error(styler.red(err.message));
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const importer = opts.importer ?? new MarkItDownImporter({ command: markitdownCommandFromEnv() });
  const cache = new FileImportCache(join(dir, ".makedown", "imports"));
  const extensionHint = extname(inputPath) || undefined;

  let result;
  try {
    result = await importWithCache(importer, cache, {
      path: inputPath,
      bytes,
      hints: { extensionHint },
    });
  } catch (err) {
    if (err instanceof ImporterError) {
      console.error(styler.red(err.message));
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, result.markdown, "utf8");

  const ref = relOut.replaceAll("\\", "/");
  console.log(
    styler.green(`✓ Imported ${file} → ${outPath}`) +
      (result.cached ? styler.dim(" (from cache)") : ""),
  );
  console.log(
    styler.dim(`  ${result.markdown.length} chars of Markdown — reference it as {{${ref}}} in build.md.`),
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
