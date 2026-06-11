/**
 * The build orchestrator — the "make" loop.
 *
 * `planBuild` resolves inputs, computes identity hashes, and reports which
 * targets are stale (this backs `md status`). `runBuild` executes only the stale
 * targets, reuses the rest from the CAS, and materializes every target's output
 * file on disk so downstream targets (and the user) can read it.
 *
 * Each stale target is dispatched by step type: `chat`/`eval` and `map` call the
 * injected Provider; `transform` runs deterministic workspace code at zero token
 * cost; `agent` runs a general-purpose coding agent in an isolated sandbox behind
 * an approval gate. Prompt interpolation and list parsing live in template.ts;
 * cost estimation in cost.ts.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { bareRef } from "@makedown/format";
import type { Provider } from "@makedown/providers";
import type { AgentRunner, AgentRunResult } from "@makedown/agents";
import type { BuildDoc, Provenance, ResolvedInput, StepType, TargetBlock } from "@makedown/shared";
import { computeIdentityHash, sha256 } from "./hash.js";
import type { Cas } from "./cas.js";
import { buildGraph, type BuildGraph } from "./graph.js";
import { provisionSandbox } from "./sandbox.js";
import { realResolveInWorkspace, PathEscapeError } from "./paths.js";
import { runSandboxedTransform } from "./transform-sandbox.js";
import { runContainerTransform } from "./transform-container.js";
import { renderTemplate, readRefContent, parseList } from "./template.js";

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

/**
 * Default ceiling on how many items a single `map` step may fan out over. A
 * runaway or untrusted list would otherwise spawn unbounded provider calls
 * (cost + rate-limit DoS). Override per build via {@link BuildContext.maxMapFanout}.
 */
export const DEFAULT_MAP_FANOUT_CAP = 1000;

/**
 * The human-in-the-loop decision for an `approval: required` artifact (typically
 * an `agent` step). The engine calls `ctx.approve` with this and only accepts the
 * artifact — writing it to disk + CAS so downstream targets consume it — if the
 * approver resolves `true`.
 */
/**
 * A per-target lifecycle event emitted during {@link runBuild} via
 * {@link BuildContext.onProgress}. Lets a caller (e.g. the cloud server) stream
 * build progress without polling. Purely observational — never alters the build.
 */
export type BuildEvent =
  | { readonly type: "target-start"; readonly target: string; readonly stale: boolean }
  | { readonly type: "target-built"; readonly target: string }
  | { readonly type: "target-reused"; readonly target: string }
  | { readonly type: "target-denied"; readonly target: string }
  | { readonly type: "target-skipped"; readonly target: string };

export interface ApprovalRequest {
  readonly target: string;
  /** Identity hash the artifact would be stored under. */
  readonly id: string;
  /** Output path the artifact would be written to. */
  readonly output: string;
  /** The produced content (e.g. a diff), for the approver to inspect. */
  readonly preview: string;
  readonly step: StepType;
}

export interface BuildContext {
  /** Absolute path to the workspace root (where build.md + sources live). */
  readonly workspaceDir: string;
  readonly cas: Cas;
  /** Required to actually execute model steps; omit for plan-only. */
  readonly provider?: Provider;
  /** Required to execute `agent` steps; omit for plan-only or model-only builds. */
  readonly agentRunner?: AgentRunner;
  /**
   * Approval gate for `approval: required` targets. If absent, such targets are
   * denied (their artifact is not accepted) — a safe default for side-effectful
   * agent output.
   */
  readonly approve?: (request: ApprovalRequest) => Promise<boolean>;
  /**
   * Maximum number of items a single `map` step may fan out over.
   * Defaults to {@link DEFAULT_MAP_FANOUT_CAP}. Exceeding it fails the build
   * before any provider call is made.
   */
  readonly maxMapFanout?: number;
  /** Wall-clock cap (ms) for a single sandboxed `transform` run. */
  readonly transformTimeoutMs?: number;
  /** Heap cap (MB) for a single sandboxed `transform` run. */
  readonly transformMemoryMb?: number;
  /** Image for `sandbox: container` transforms. Defaults to a small Node image. */
  readonly transformContainerImage?: string;
  /** Clock injection for deterministic tests. Defaults to Date. */
  readonly now?: () => Date;
  /**
   * Optional observer of per-target build progress. Lets a caller stream
   * lifecycle events (e.g. over SSE) without polling. See {@link BuildEvent}.
   * Never affects the build outcome; exceptions thrown here are not caught.
   */
  readonly onProgress?: (event: BuildEvent) => void;
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
      const abs = await realResolveInWorkspace(ctx.workspaceDir, ref);
      const bytes = await readFile(abs);
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
      const abs = await realResolveInWorkspace(ctx.workspaceDir, target.header.transform);
      const bytes = await readFile(abs);
      return [sha256(new Uint8Array(bytes))];
    } catch (err) {
      // A path that escapes the workspace is a hard error, not a missing script.
      if (err instanceof PathEscapeError) throw err;
      return ["sha256:missing-transform-script"];
    }
  }
  return undefined;
}

export interface BuildResult {
  readonly plan: BuildPlan;
  readonly built: readonly string[];
  readonly reused: readonly string[];
  /**
   * Targets not produced because an `approval: required` artifact was denied —
   * plus any downstream targets skipped because that upstream artifact is missing.
   */
  readonly rejected: readonly string[];
}

/** Execute the build: recompute only stale targets, reuse the rest. */
export async function runBuild(doc: BuildDoc, ctx: BuildContext): Promise<BuildResult> {
  const plan = await planBuild(doc, ctx);
  const byName = new Map(doc.targets.map((t) => [t.name, t] as const));
  const outputs = new Map(doc.targets.map((t) => [t.name, t.header.output] as const));
  const built: string[] = [];
  const reused: string[] = [];
  const denied = new Set<string>();

  for (const tp of plan.targets) {
    const target = byName.get(tp.name);
    if (!target) continue;

    // A target whose dependency was denied (unapproved agent output) can't be
    // produced — skip it and propagate the denial downstream.
    const deps = plan.graph.nodes.get(tp.name)?.deps ?? [];
    if (deps.some((d) => denied.has(d))) {
      denied.add(tp.name);
      ctx.onProgress?.({ type: "target-skipped", target: tp.name });
      continue;
    }

    ctx.onProgress?.({ type: "target-start", target: tp.name, stale: tp.stale });
    if (tp.stale) {
      const accepted = await executeTarget(target, tp, ctx, outputs);
      if (accepted) {
        built.push(tp.name);
        ctx.onProgress?.({ type: "target-built", target: tp.name });
      } else {
        denied.add(tp.name);
        ctx.onProgress?.({ type: "target-denied", target: tp.name });
      }
    } else {
      await materialize(tp, target, ctx);
      reused.push(tp.name);
      ctx.onProgress?.({ type: "target-reused", target: tp.name });
    }
  }

  return { plan, built, reused, rejected: [...denied] };
}

/**
 * Dispatch a stale target to the executor for its step type. Returns `true` when
 * the artifact was produced and accepted, `false` when an `agent` artifact was
 * denied at the approval gate.
 */
async function executeTarget(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<boolean> {
  switch (target.header.step) {
    case "chat":
    case "eval":
      await (target.header.cache.kind === "stochastic"
        ? executeStochasticModelStep(target, tp, ctx, outputs)
        : executeModelStep(target, tp, ctx, outputs));
      return true;
    case "transform":
      await executeTransform(target, tp, ctx, outputs);
      return true;
    case "map":
      await executeMap(target, tp, ctx, outputs);
      return true;
    case "agent":
      return executeAgentStep(target, tp, ctx, outputs);
    default:
      throw new NotImplementedError(
        `step "${target.header.step}" is not implemented yet (target "${target.name}")`,
      );
  }
}

/** Run a single model inference (`chat`/`eval`) and record provenance. */
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

  const prompt = await renderTemplate(target.body, ctx.workspaceDir, outputs, false);
  const system = target.header.system
    ? await renderTemplate(target.header.system, ctx.workspaceDir, outputs, false)
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

  const prompt = await renderTemplate(target.body, ctx.workspaceDir, outputs, false);
  const system = target.header.system
    ? await renderTemplate(target.header.system, ctx.workspaceDir, outputs, false)
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
  const content = (await ctx.cas.getSample(tp.id, blessed)) ?? (await ctx.cas.getSample(tp.id, 0));
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

  const items = parseList(await readRefContent(over, ctx.workspaceDir, outputs));

  // Cap the fan-out before any provider call so a runaway/untrusted list can't
  // spawn unbounded inference (cost + rate-limit DoS). Fail fast and loud.
  const cap = ctx.maxMapFanout ?? DEFAULT_MAP_FANOUT_CAP;
  if (items.length > cap) {
    throw new Error(
      `map target "${target.name}" fans out over ${items.length} items, exceeding the cap of ${cap}. ` +
        `Reduce the "over" list or raise maxMapFanout if this is intentional.`,
    );
  }

  const results: string[] = [];
  let input = 0;
  let output = 0;
  let costUsd = 0;

  const start = Date.now();
  for (const item of items) {
    const bindings = new Map([["item", item]]);
    const prompt = await renderTemplate(target.body, ctx.workspaceDir, outputs, false, bindings);
    const system = target.header.system
      ? await renderTemplate(target.header.system, ctx.workspaceDir, outputs, false, bindings)
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
 * Run an `agent` step: a general-purpose coding agent in an isolated sandbox.
 *
 * The engine renders the task prompt, provisions a sandbox per the target's
 * `sandbox` policy (a throwaway git worktree by default), and hands it to the
 * injected runner. The sandbox is always torn down. If `approval: required`, the
 * produced artifact is gated behind `ctx.approve` — denied output is never
 * written to disk or the CAS, so downstream targets cannot consume it. Returns
 * `false` when the artifact was denied.
 */
async function executeAgentStep(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<boolean> {
  if (!ctx.agentRunner) {
    throw new Error(`No agent runner configured; cannot execute agent target "${target.name}"`);
  }

  const prompt = await renderTemplate(target.body, ctx.workspaceDir, outputs, false);
  const system = target.header.system
    ? await renderTemplate(target.header.system, ctx.workspaceDir, outputs, false)
    : undefined;

  const sandbox = await provisionSandbox(ctx.workspaceDir, target.header.sandbox);
  let result: AgentRunResult;
  let durationMs: number;
  let diff: string | undefined;
  try {
    const start = Date.now();
    result = await ctx.agentRunner.run({
      agent: target.header.agent ?? "",
      model: target.header.model,
      system,
      prompt,
      params: target.header.params,
      workdir: sandbox.dir,
    });
    durationMs = Date.now() - start;
    diff = await sandbox.diff();
  } finally {
    await sandbox.cleanup();
  }

  // The artifact is the work the agent actually did — the unified diff of its
  // sandbox — falling back to the agent's text summary when the sandbox can't
  // produce a diff (e.g. `sandbox: none`) or the agent changed nothing.
  const artifactText = diff && diff.trim().length > 0 ? diff : result.output;

  // Approval gate: side-effectful agent output is accepted only on explicit
  // approval. No approver wired ⇒ deny (safe default).
  if (target.header.approval === "required") {
    const approved = ctx.approve
      ? await ctx.approve({
          target: target.name,
          id: tp.id,
          output: target.header.output,
          preview: artifactText,
          step: "agent",
        })
      : false;
    if (!approved) return false;
  }

  const content = new TextEncoder().encode(artifactText);
  await ctx.cas.put(tp.id, content);
  await writeOutput(ctx, target.header.output, content);

  const provenance: Provenance = {
    target: target.name,
    id: tp.id,
    output: target.header.output,
    step: "agent",
    model: target.header.model,
    params: target.header.params,
    inputs: tp.inputs,
    promptHash: sha256(prompt),
    tokens: result.usage,
    costUsd: result.costUsd,
    durationMs,
    producedAt: timestamp(ctx),
    producedBy: result.producedBy,
  };
  await ctx.cas.putProvenance(provenance);
  return true;
}

/**
 * Run a deterministic workspace script (`transform`) at zero token cost — the
 * "code where code is enough" step. The script is a workspace-authored ES module
 * that exports a function over the resolved input contents. Its content is part
 * of the target's identity hash, so editing the script rebuilds the artifact.
 *
 * Isolation is selected by the target's `sandbox` field:
 *   - `none` — imported and run **in-process** (trusted, like a Makefile recipe).
 *   - `worktree` (default) — run in a locked-down subprocess (no ambient
 *     filesystem, memory + time caps) via {@link runSandboxedTransform}.
 *   - `container` — run in Docker (also network-isolated) via
 *     {@link runContainerTransform}.
 */
async function executeTransform(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
): Promise<void> {
  const { absPath, hash } = await resolveTransformScript(target, ctx);
  const inputs = await resolveInputContents(target, ctx, outputs);

  const start = Date.now();
  const produced = await runTransform(target, absPath, hash, inputs, ctx);
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
    promptHash: hash,
    costUsd: 0,
    durationMs,
    producedAt: timestamp(ctx),
  };
  await ctx.cas.putProvenance(provenance);
}

/** Confine + read a transform script, returning its absolute path and content hash. */
async function resolveTransformScript(
  target: TargetBlock,
  ctx: BuildContext,
): Promise<{ absPath: string; hash: string }> {
  const rel = target.header.transform;
  if (!rel) {
    throw new Error(`Target "${target.name}" step=transform requires a "transform" script path`);
  }
  // Confine the script path to the workspace before any IO (throws on escape).
  const absPath = await realResolveInWorkspace(ctx.workspaceDir, rel);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(absPath));
  } catch {
    throw new Error(`Transform script not found: ${rel} (target "${target.name}")`);
  }
  return { absPath, hash: sha256(bytes) };
}

/** Dispatch transform execution to the isolation level named by `sandbox`. */
async function runTransform(
  target: TargetBlock,
  absPath: string,
  hash: string,
  inputs: Record<string, string>,
  ctx: BuildContext,
): Promise<unknown> {
  switch (target.header.sandbox) {
    case "none":
      return runTransformInProcess(absPath, hash, target.header.transform ?? "", inputs);
    case "container":
      return runContainerTransform({
        scriptPath: absPath,
        inputs,
        timeoutMs: ctx.transformTimeoutMs,
        memoryMb: ctx.transformMemoryMb,
        image: ctx.transformContainerImage,
      });
    case "worktree":
      return runSandboxedTransform({
        scriptPath: absPath,
        inputs,
        timeoutMs: ctx.transformTimeoutMs,
        memoryMb: ctx.transformMemoryMb,
      });
  }
}

/** Trusted fast path: import the script in-process and call its exported function. */
async function runTransformInProcess(
  absPath: string,
  hash: string,
  rel: string,
  inputs: Record<string, string>,
): Promise<unknown> {
  // Cache-bust the ESM import by content hash so an edited script re-imports.
  const url = `${pathToFileURL(absPath).href}?v=${hash.slice("sha256:".length)}`;
  const mod = (await import(url)) as Record<string, unknown>;
  const fn = mod["default"] ?? mod["transform"];
  if (typeof fn !== "function") {
    throw new Error(
      `Transform "${rel}" must export a function (default export or named "transform")`,
    );
  }
  return (fn as (i: Record<string, string>) => unknown)(inputs);
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
    out[ref] = await readRefContent(ref, ctx.workspaceDir, outputs);
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
  // Confine the output path to the workspace (throws on escape / symlinked parent).
  const path = await realResolveInWorkspace(ctx.workspaceDir, output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
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
  const prompt = await renderTemplate(target.body, ctx.workspaceDir, outputs, true);
  const system = target.header.system
    ? await renderTemplate(target.header.system, ctx.workspaceDir, outputs, true)
    : undefined;
  return { system, prompt };
}
