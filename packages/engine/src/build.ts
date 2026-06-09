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
    });
    ids.set(name, id);

    const stale = target.header.cache.kind === "always" ? true : !(await ctx.cas.has(id));
    plans.push({ name, id, stale, inputs });
  }

  return { graph, targets: plans, ids };
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

async function executeTarget(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<void> {
  if (target.header.step !== "chat") {
    throw new NotImplementedError(
      `step "${target.header.step}" is not implemented yet (target "${target.name}")`,
    );
  }
  if (!ctx.provider) {
    throw new Error(`No provider configured; cannot execute chat target "${target.name}"`);
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
    producedAt: (ctx.now?.() ?? new Date()).toISOString(),
  };
  await ctx.cas.putProvenance(provenance);
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
): Promise<string> {
  void refsInBody; // refs were validated at parse time; we substitute live matches here
  return replaceAsync(text, REF_RE, async (inner) => {
    const trimmed = inner.trim();
    const ref = bareRef(trimmed);
    const suffix = suffixOf(trimmed);
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
