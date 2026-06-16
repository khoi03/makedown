/**
 * Cost estimation for `md cost` — a headless token/$ pre-pass that never calls a
 * model. Input tokens come from the rendered prompts; output tokens are the
 * `max_tokens` upper bound. Only stale model targets contribute to the total.
 */
import { resolveMaxTokens, estimateCostUsd, parseModelRef } from "@makedown/providers";
import type { BuildDoc, StepType, TargetBlock } from "@makedown/shared";
import { planBuild, type BuildContext, type TargetPlan } from "./build.js";
import { renderTemplate, readRefContent, parseList } from "./template.js";
import { ImportResolver } from "./imports.js";

const CHARS_PER_TOKEN = 4;

/** Approximate token count from text length (~4 chars/token). A rough estimate. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Per-target cost estimate. Output tokens are an upper bound (the `max_tokens` cap). */
export interface TargetCost {
  readonly target: string;
  readonly step: StepType;
  readonly model?: string;
  readonly stale: boolean;
  /** Number of model calls (1 for chat/eval, item-count for map, 0 for transform). */
  readonly calls: number;
  readonly inputTokens: number;
  readonly maxOutputTokens: number;
  /** Upper-bound USD (input + max output), or undefined if the model isn't priced. */
  readonly costUsd?: number;
}

export interface BuildCost {
  readonly targets: readonly TargetCost[];
  /** Sum of priced, stale model targets. Excludes fresh and unpriced targets. */
  readonly totalCostUsd: number;
  /** True if any stale model target uses a model with no known pricing. */
  readonly hasUnpriced: boolean;
}

function isModelStep(step: StepType): boolean {
  return step === "chat" || step === "eval" || step === "map";
}

/**
 * Estimate the token/$ cost of building a workspace without calling any model.
 * Only stale model targets contribute to the total.
 */
export async function estimateBuildCost(doc: BuildDoc, ctx: BuildContext): Promise<BuildCost> {
  const plan = await planBuild(doc, ctx);
  const byName = new Map(doc.targets.map((t) => [t.name, t] as const));
  const outputs = new Map(doc.targets.map((t) => [t.name, t.header.output] as const));
  const resolver = new ImportResolver({
    importer: ctx.importer,
    importCache: ctx.importCache,
    importableExtensions: ctx.importableExtensions,
  });

  const targets: TargetCost[] = [];
  let totalCostUsd = 0;
  let hasUnpriced = false;

  for (const tp of plan.targets) {
    const target = byName.get(tp.name);
    if (!target) continue;
    const cost = await costForTarget(target, tp, ctx, outputs, resolver);
    targets.push(cost);
    if (tp.stale && isModelStep(target.header.step)) {
      if (cost.costUsd === undefined) hasUnpriced = true;
      else totalCostUsd += cost.costUsd;
    }
  }
  return { targets, totalCostUsd, hasUnpriced };
}

async function costForTarget(
  target: TargetBlock,
  tp: TargetPlan,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
  resolver: ImportResolver,
): Promise<TargetCost> {
  const step = target.header.step;
  const common = { target: target.name, step, model: target.header.model, stale: tp.stale };

  if (!isModelStep(step)) {
    return { ...common, calls: 0, inputTokens: 0, maxOutputTokens: 0, costUsd: 0 };
  }

  const maxPerCall = resolveMaxTokens(target.header.params);

  if (step === "map") {
    const items = target.header.over ? await safeList(target.header.over, ctx, outputs, resolver) : [];
    const perItem = await renderForCost(target, ctx, outputs, items[0] ?? "", resolver);
    const inputTokens = estimateTokens(perItem) * items.length;
    const maxOutputTokens = maxPerCall * items.length;
    return {
      ...common,
      calls: items.length,
      inputTokens,
      maxOutputTokens,
      costUsd: priceUsd(target.header.model, inputTokens, maxOutputTokens),
    };
  }

  // chat | eval
  const inputTokens = estimateTokens(await renderForCost(target, ctx, outputs, undefined, resolver));
  return {
    ...common,
    calls: 1,
    inputTokens,
    maxOutputTokens: maxPerCall,
    costUsd: priceUsd(target.header.model, inputTokens, maxPerCall),
  };
}

/** Render system + prompt for estimation (unbuilt deps become placeholders). */
async function renderForCost(
  target: TargetBlock,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
  item: string | undefined,
  resolver: ImportResolver,
): Promise<string> {
  const bindings = item !== undefined ? new Map([["item", item]]) : undefined;
  const prompt = await renderTemplate(target.body, ctx.workspaceDir, outputs, true, bindings, resolver);
  const system = target.header.system
    ? await renderTemplate(target.header.system, ctx.workspaceDir, outputs, true, bindings, resolver)
    : "";
  return `${system}\n${prompt}`;
}

async function safeList(
  over: string,
  ctx: BuildContext,
  outputs: ReadonlyMap<string, string>,
  resolver: ImportResolver,
): Promise<string[]> {
  try {
    return parseList(await readRefContent(over, ctx.workspaceDir, outputs, resolver));
  } catch {
    return [];
  }
}

function priceUsd(
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  if (!model) return undefined;
  const { model: bare } = parseModelRef(model, "anthropic");
  return estimateCostUsd(bare, inputTokens, outputTokens);
}
