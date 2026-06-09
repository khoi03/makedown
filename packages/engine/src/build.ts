/**
 * The build orchestrator — the "make" loop.
 *
 * `planBuild` resolves inputs, computes identity hashes, and reports which
 * targets are stale (this backs `md status`). `runBuild` executes only the stale
 * targets, reuses the rest from the CAS, and materializes every target's output
 * file on disk so downstream targets (and the user) can read it.
 *
 * `chat` targets are dispatched to the injected Provider. Non-`chat` step types
 * (`agent`/`transform`/`eval`/`map`) throw NotImplemented — finishing those is
 * the next tranche of work.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { refsInBody, bareRef } from "@makedown/format";
import type { Provider } from "@makedown/providers";
import type { BuildDoc, Provenance, ResolvedInput, TargetBlock } from "@makedown/shared";
import { computeIdentityHash, sha256 } from "./hash.js";
import type { Cas } from "./cas.js";
import { buildGraph, type BuildGraph } from "./graph.js";

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

export interface BuildContext {
  /** Absolute path to the workspace root (where build.md + sources live). */
  readonly workspaceDir: string;
  readonly cas: Cas;
  /** Required to actually execute model steps; omit for plan-only. */
  readonly provider?: Provider;
  /** Clock injection for deterministic tests. Defaults to Date. */
  readonly now?: () => Date;
}

export interface TargetPlan {
  readonly name: string;
  readonly id: string;
  readonly stale: boolean;
  readonly inputs: readonly ResolvedInput[];
}

export interface BuildPlan {
  readonly graph: BuildGraph;
  readonly targets: readonly TargetPlan[];
  /** Map of target name -> identity hash, in execution order. */
  readonly ids: ReadonlyMap<string, string>;
}

/** Resolve inputs, compute identity hashes, and detect stale targets. No model calls. */
export async function planBuild(doc: BuildDoc, ctx: BuildContext): Promise<BuildPlan> {
  const graph = buildGraph(doc);
  const byName = new Map(doc.targets.map((t) => [t.name, t] as const));
  const ids = new Map<string, string>();
  const plans: TargetPlan[] = [];

  for (const name of graph.order) {
    const target = byName.get(name);
    if (!target) continue;

    const inputs = await resolveInputs(target, ids, ctx);
    const id = computeIdentityHash({
      inputHashes: inputs.map((i) => i.hash),
      header: target.header,
      body: target.body,
      auxHashes: await auxHashesFor(target, ctx),
    });
    ids.set(name, id);

    const stale = await isStale(target, id, ctx);
    plans.push({ name, id, stale, inputs });
  }

  return { graph, targets: plans, ids };
}

/**
 * Whether a target must (re)compute. `always` is never cached; `stochastic(n=k)`
 * is stale until k samples exist; `deterministic` is stale until its artifact is
 * in the CAS.
 */
async function isStale(target: TargetBlock, id: string, ctx: BuildContext): Promise<boolean> {
  const cache = target.header.cache;
  if (cache.kind === "always") return true;
  if (cache.kind === "stochastic") return (await ctx.cas.countSamples(id)) < cache.n;
  return !(await ctx.cas.has(id));
}

async function resolveInputs(
  target: TargetBlock,
  ids: ReadonlyMap<string, string>,
  ctx: BuildContext,
): Promise<ResolvedInput[]> {
  const resolved: ResolvedInput[] = [];
  for (const input of target.header.inputs) {
    const ref = bareRef(input);
    const depId = ids.get(ref);
    if (depId !== undefined) {
      // Dependency target: its identity hash *is* the input hash.
      resolved.push({ ref, kind: "target", hash: depId });
    } else {
      const bytes = await readFile(join(ctx.workspaceDir, ref));
      resolved.push({ ref, kind: "source", hash: sha256(new Uint8Array(bytes)) });
    }
  }
  return resolved;
}

/**
 * Content hashes that influence a target's output but aren't declared inputs.
 * For `transform`, the script's content is folded in so editing it rebuilds.
 * Tolerant of a missing script (returns a sentinel) so `md status` still works;
 * the build then fails with a clear error.
 */
async function auxHashesFor(
  target: TargetBlock,
  ctx: BuildContext,
): Promise<readonly string[] | undefined> {
  if (target.header.step === "transform" && target.header.transform) {
    try {
      const bytes = await readFile(join(ctx.workspaceDir, target.header.transform));
      return [sha256(new Uint8Array(bytes))];
    } catch {
      return ["sha256:missing-transform-script"];
    }
  }
  return undefined;
}

export interface BuildResult {
  readonly plan: BuildPlan;
  readonly built: readonly string[];
  readonly reused: readonly string[];
}

/** Execute the build: recompute only stale targets, reuse the rest. */
export async function runBuild(doc: BuildDoc, ctx: BuildContext): Promise<BuildResult> {
  const plan = await planBuild(doc, ctx);
  const byName = new Map(doc.targets.map((t) => [t.name, t] as const));
  const outputs = new Map(doc.targets.map((t) => [t.name, t.header.output] as const));
  const built: string[] = [];
  const reused: string[] = [];

  for (const tp of plan.targets) {
    const target = byName.get(tp.name);
    if (!target) continue;

    if (tp.stale) {
      await executeTarget(target, tp, ctx, outputs);
      built.push(tp.name);
    } else {
      await materialize(tp, target, ctx);
      reused.push(tp.name);
    }
  }

  return { plan, built, reused };
}

/** Dispatch a stale target to the executor for its step type. */
async function executeTarget(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<void> {
  switch (target.header.step) {
    case "chat":
    case "eval":
      return target.header.cache.kind === "stochastic"
        ? executeStochasticModelStep(target, tp, ctx, outputs)
        : executeModelStep(target, tp, ctx, outputs);
    case "transform":
      return executeTransform(target, tp, ctx, outputs);
    case "map":
      return executeMap(target, tp, ctx, outputs);
    default:
      throw new NotImplementedError(
        `step "${target.header.step}" is not implemented yet (target "${target.name}")`,
      );
  }
}

/** Run a single model inference (`chat`) and record provenance. */
async function executeModelStep(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<void> {
  if (!ctx.provider) {
    throw new Error(
      `No provider configured; cannot execute ${target.header.step} target "${target.name}"`,
    );
  }

  const prompt = await renderTemplate(target.body, ctx, outputs, false);
  const system = target.header.system
    ? await renderTemplate(target.header.system, ctx, outputs, false)
    : undefined;
  const start = Date.now();
  const result = await ctx.provider.complete({
    model: target.header.model ?? "",
    system,
    prompt,
    params: target.header.params,
  });
  const durationMs = Date.now() - start;

  // An `eval` target with a declared `schema` must return structured JSON.
  // Full JSON-Schema conformance is a future refinement (SPEC §11); for now we
  // enforce parseability so downstream targets can consume a real object.
  if (target.header.step === "eval" && target.header.schema !== undefined) {
    assertJson(result.text, target.name);
  }

  const content = new TextEncoder().encode(result.text);
  await ctx.cas.put(tp.id, content);
  await writeOutput(ctx, target.header.output, content);

  const provenance: Provenance = {
    target: target.name,
    id: tp.id,
    output: target.header.output,
    step: target.header.step,
    model: target.header.model,
    params: target.header.params,
    inputs: tp.inputs,
    promptHash: sha256(prompt),
    tokens: result.usage,
    costUsd: result.costUsd,
    durationMs,
    producedAt: timestamp(ctx),
  };
  await ctx.cas.putProvenance(provenance);
}

/**
 * Run a `stochastic(n=k)` model step. Generates samples up to k (topping up only
 * the missing ones after an interrupted build), persisting each as a sibling
 * under the identity hash. The blessed sample (default index 0) is materialized
 * as the canonical artifact and output, so downstream targets consume it.
 */
async function executeStochasticModelStep(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<void> {
  if (!ctx.provider) {
    throw new Error(
      `No provider configured; cannot execute ${target.header.step} target "${target.name}"`,
    );
  }
  const cache = target.header.cache;
  const k = cache.kind === "stochastic" ? cache.n : 1;
  const existing = await ctx.cas.countSamples(tp.id);

  const prompt = await renderTemplate(target.body, ctx, outputs, false);
  const system = target.header.system
    ? await renderTemplate(target.header.system, ctx, outputs, false)
    : undefined;

  for (let index = existing; index < k; index++) {
    const start = Date.now();
    const result = await ctx.provider.complete({
      model: target.header.model ?? "",
      system,
      prompt,
      params: target.header.params,
    });
    const durationMs = Date.now() - start;
    const provenance: Provenance = {
      target: target.name,
      id: tp.id,
      output: target.header.output,
      step: target.header.step,
      model: target.header.model,
      params: target.header.params,
      inputs: tp.inputs,
      promptHash: sha256(prompt),
      tokens: result.usage,
      costUsd: result.costUsd,
      durationMs,
      producedAt: timestamp(ctx),
    };
    await ctx.cas.putSample({
      id: tp.id,
      index,
      content: new TextEncoder().encode(result.text),
      provenance,
    });
  }

  await materializeBlessed(target, tp, ctx);
}

/** Promote the blessed sample to the canonical artifact + output path. */
async function materializeBlessed(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
): Promise<void> {
  const blessed = await ctx.cas.getBlessed(tp.id);
  const content =
    (await ctx.cas.getSample(tp.id, blessed)) ?? (await ctx.cas.getSample(tp.id, 0));
  if (!content) return;
  await ctx.cas.put(tp.id, content);
  await writeOutput(ctx, target.header.output, content);
  const provenance =
    (await ctx.cas.getSampleProvenance(tp.id, blessed)) ??
    (await ctx.cas.getSampleProvenance(tp.id, 0));
  if (provenance) await ctx.cas.putProvenance(provenance);
}

/** Assert that text is valid JSON; throws a clear error otherwise. */
function assertJson(text: string, targetName: string): void {
  try {
    JSON.parse(text);
  } catch {
    throw new Error(
      `eval target "${targetName}" declares a schema but its output is not valid JSON`,
    );
  }
}

/**
 * Run a `map` step: resolve the `over` input to a list, then call the model once
 * per item with `{{item}}` bound to that item. Results are collected into one
 * JSON-array artifact; token usage and cost are summed across items.
 */
async function executeMap(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<void> {
  if (!ctx.provider) {
    throw new Error(`No provider configured; cannot execute map target "${target.name}"`);
  }
  const over = target.header.over;
  if (!over) {
    throw new Error(`Target "${target.name}" step=map requires an "over" input`);
  }

  const items = parseList(await readRefContent(over, ctx, outputs));
  const results: string[] = [];
  let input = 0;
  let output = 0;
  let costUsd = 0;

  const start = Date.now();
  for (const item of items) {
    const bindings = new Map([["item", item]]);
    const prompt = await renderTemplate(target.body, ctx, outputs, false, bindings);
    const system = target.header.system
      ? await renderTemplate(target.header.system, ctx, outputs, false, bindings)
      : undefined;
    const result = await ctx.provider.complete({
      model: target.header.model ?? "",
      system,
      prompt,
      params: target.header.params,
    });
    results.push(result.text);
    input += result.usage.input;
    output += result.usage.output;
    costUsd += result.costUsd ?? 0;
  }
  const durationMs = Date.now() - start;

  const content = new TextEncoder().encode(JSON.stringify(results, null, 2));
  await ctx.cas.put(tp.id, content);
  await writeOutput(ctx, target.header.output, content);

  const provenance: Provenance = {
    target: target.name,
    id: tp.id,
    output: target.header.output,
    step: "map",
    model: target.header.model,
    params: target.header.params,
    inputs: tp.inputs,
    promptHash: sha256(target.body),
    tokens: { input, output },
    costUsd,
    durationMs,
    producedAt: timestamp(ctx),
  };
  await ctx.cas.putProvenance(provenance);
}

/**
 * Parse a `map` source into items: a JSON array (each element stringified) when
 * the content is one, else newline-delimited (blank lines dropped).
 */
function parseList(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
      }
    } catch {
      // Not valid JSON — fall through to newline mode.
    }
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Run a deterministic workspace script (`transform`) at zero token cost — the
 * "code where code is enough" step. The script is a workspace-authored ES module
 * (trusted like a Makefile recipe) that exports a function over the resolved
 * input contents. Its content is part of the target's identity hash, so editing
 * the script rebuilds the artifact.
 */
async function executeTransform(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<void> {
  const script = await loadTransform(target, ctx);
  const inputs = await resolveInputContents(target, ctx, outputs);

  const start = Date.now();
  const produced = await script.fn(inputs);
  const durationMs = Date.now() - start;

  const content = toBytes(produced, target.name);
  await ctx.cas.put(tp.id, content);
  await writeOutput(ctx, target.header.output, content);

  const provenance: Provenance = {
    target: target.name,
    id: tp.id,
    output: target.header.output,
    step: "transform",
    model: target.header.model,
    params: target.header.params,
    inputs: tp.inputs,
    promptHash: script.hash,
    costUsd: 0,
    durationMs,
    producedAt: timestamp(ctx),
  };
  await ctx.cas.putProvenance(provenance);
}

interface LoadedTransform {
  readonly fn: (inputs: Record<string, string>) => unknown;
  readonly hash: string;
}

/** Import a transform script, returning its exported function and content hash. */
async function loadTransform(target: TargetBlock, ctx: BuildContext): Promise<LoadedTransform> {
  const rel = target.header.transform;
  if (!rel) {
    throw new Error(`Target "${target.name}" step=transform requires a "transform" script path`);
  }
  const absPath = join(ctx.workspaceDir, rel);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(absPath));
  } catch {
    throw new Error(`Transform script not found: ${rel} (target "${target.name}")`);
  }
  const hash = sha256(bytes);
  // Cache-bust the ESM import by content hash so an edited script re-imports.
  const url = `${pathToFileURL(absPath).href}?v=${hash.slice("sha256:".length)}`;
  const mod = (await import(url)) as Record<string, unknown>;
  const fn = mod["default"] ?? mod["transform"];
  if (typeof fn !== "function") {
    throw new Error(
      `Transform "${rel}" must export a function (default export or named "transform")`,
    );
  }
  return { fn: fn as LoadedTransform["fn"], hash };
}

/** Resolve every declared input to its string content (for transform scripts). */
async function resolveInputContents(
  target: TargetBlock,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const input of target.header.inputs) {
    const ref = bareRef(input);
    out[ref] = await readRefContent(ref, ctx, outputs);
  }
  return out;
}

function toBytes(produced: unknown, targetName: string): Uint8Array {
  if (produced instanceof Uint8Array) return produced;
  if (typeof produced === "string") return new TextEncoder().encode(produced);
  throw new Error(
    `Transform for "${targetName}" must return a string or Uint8Array (got ${typeof produced})`,
  );
}

function timestamp(ctx: BuildContext): string {
  return (ctx.now?.() ?? new Date()).toISOString();
}

/** Reused target: write its cached artifact back to the output path if needed. */
async function materialize(tp: TargetPlan, target: TargetBlock, ctx: BuildContext): Promise<void> {
  const content = await ctx.cas.get(tp.id);
  if (content) await writeOutput(ctx, target.header.output, content);
}

async function writeOutput(ctx: BuildContext, output: string, content: Uint8Array): Promise<void> {
  const path = join(ctx.workspaceDir, output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const REF_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Render a template (a prompt body or system prompt) by interpolating `{{ref}}`
 * (and `{{ref:head(n)}}`). When `previewMissingTargets` is true, an unbuilt
 * dependency artifact renders as a placeholder instead of throwing — used by
 * `md render` so prompts can be inspected before a build.
 */
async function renderTemplate(
  text: string,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
  previewMissingTargets: boolean,
  bindings?: ReadonlyMap<string, string>,
): Promise<string> {
  void refsInBody; // refs were validated at parse time; we substitute live matches here
  return replaceAsync(text, REF_RE, async (inner) => {
    const trimmed = inner.trim();
    const ref = bareRef(trimmed);
    const suffix = suffixOf(trimmed);
    // In-memory bindings (e.g. a `map` step's {{item}}) take precedence over IO.
    const bound = bindings?.get(ref);
    if (bound !== undefined) return applySuffix(bound, suffix);
    try {
      const content = await readRefContent(ref, ctx, outputs);
      return applySuffix(content, suffix);
    } catch (err) {
      if (previewMissingTargets && outputs.has(ref)) return `«unbuilt artifact: ${ref}»`;
      throw err;
    }
  });
}

export interface RenderedPrompt {
  readonly system?: string;
  readonly prompt: string;
}

/**
 * Resolve the exact system + user prompt a target would send, without calling a
 * model. Unbuilt dependency artifacts render as placeholders. Powers `md render`.
 */
export async function renderTarget(
  doc: BuildDoc,
  name: string,
  ctx: BuildContext,
): Promise<RenderedPrompt> {
  const target = doc.targets.find((t) => t.name === name);
  if (!target) throw new Error(`Unknown target: ${name}`);
  const outputs = new Map(doc.targets.map((t) => [t.name, t.header.output] as const));
  const prompt = await renderTemplate(target.body, ctx, outputs, true);
  const system = target.header.system
    ? await renderTemplate(target.header.system, ctx, outputs, true)
    : undefined;
  return { system, prompt };
}

async function readRefContent(
  ref: string,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<string> {
  // A target reference reads that dependency's artifact (written to its output
  // path earlier in this run); a source reference reads the file directly.
  const path = outputs.get(ref) ?? ref;
  const bytes = await readFile(join(ctx.workspaceDir, path));
  return new TextDecoder().decode(bytes);
}

function suffixOf(inner: string): string | undefined {
  const colon = inner.indexOf(":");
  return colon === -1 ? undefined : inner.slice(colon + 1);
}

const HEAD_TAIL_RE = /^(head|tail)\((\d+)\)$/;

/** Apply a supported body-transform suffix. Pre-1.0: only head/tail (SPEC §5/§11). */
function applySuffix(content: string, suffix: string | undefined): string {
  if (!suffix) return content;
  const m = HEAD_TAIL_RE.exec(suffix);
  if (!m) return content; // unknown suffix: ignore in Phase 0
  const n = Number(m[2]);
  const lines = content.split(/\r?\n/);
  return m[1] === "head" ? lines.slice(0, n).join("\n") : lines.slice(-n).join("\n");
}

async function replaceAsync(
  str: string,
  regex: RegExp,
  fn: (group: string) => Promise<string>,
): Promise<string> {
  const matches = [...str.matchAll(regex)];
  const replacements = await Promise.all(matches.map((m) => fn(m[1] ?? "")));
  let result = "";
  let last = 0;
  matches.forEach((m, i) => {
    const index = m.index ?? 0;
    result += str.slice(last, index) + (replacements[i] ?? "");
    last = index + m[0].length;
  });
  return result + str.slice(last);
}
