/**
 * Pure string renderers for the `md` CLI. These take already-computed data and a
 * styler, and return text — no IO — so they're easy to unit test. The command
 * handlers in commands.ts do the IO and print the result.
 */
import type { BuildPlan, BuildResult, BuildCost } from "@makedown/engine";
import type { Provenance, ResolvedInput } from "@makedown/shared";
import { type Styler, padCell, formatUsd, formatTokens } from "./format.js";

const GAP = "  ";

function shortHash(hash: string): string {
  const hex = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
  return hex.slice(0, 12);
}

/** `md status` — a table of targets with fresh/stale badges and dependencies. */
export function renderStatus(plan: BuildPlan, s: Styler): string {
  if (plan.targets.length === 0) return "No targets defined.";

  const nameWidth = Math.max(6, ...plan.targets.map((t) => t.name.length));
  const lines: string[] = [];
  lines.push(s.dim(padCell("Target", nameWidth) + GAP + padCell("State", 6) + GAP + "Depends on"));
  lines.push(s.dim("─".repeat(nameWidth + 6 + 20)));

  for (const tp of plan.targets) {
    const node = plan.graph.nodes.get(tp.name);
    const deps = node && node.deps.length > 0 ? node.deps.join(", ") : s.dim("—");
    const badge = tp.stale ? s.yellow("stale") : s.green("fresh");
    lines.push(padCell(tp.name, nameWidth) + GAP + padCell(badge, 6) + GAP + deps);
  }

  const stale = plan.targets.filter((t) => t.stale).length;
  const summary =
    stale === 0
      ? s.green("✓ everything fresh")
      : s.yellow(`${stale} stale`) + s.dim(` / ${plan.targets.length} total`);
  lines.push("");
  lines.push(summary);
  return lines.join("\n");
}

/** `md graph` — execution order with dependency arrows. */
export function renderGraph(plan: BuildPlan, s: Styler): string {
  const lines: string[] = [s.dim("Execution order (dependencies first):"), ""];
  for (const name of plan.graph.order) {
    const node = plan.graph.nodes.get(name);
    const deps = node && node.deps.length > 0 ? s.dim(`  ← ${node.deps.join(", ")}`) : "";
    lines.push(`  ${s.cyan(name)}${deps}`);
  }
  return lines.join("\n");
}

/** `md build` — per-target built/reused/rejected lines plus a summary. */
export function renderBuildResult(result: BuildResult, s: Styler): string {
  const built = new Set(result.built);
  const rejected = new Set(result.rejected);
  const label = (tp: { name: string }): string => {
    if (built.has(tp.name)) return s.green("✓ built");
    if (rejected.has(tp.name)) return s.red("✗ rejected");
    return s.dim("• reused");
  };
  const lines = result.plan.targets.map((tp) => {
    const name = built.has(tp.name) || rejected.has(tp.name) ? tp.name : s.dim(tp.name);
    return `${padCell(label(tp), 10)}  ${name}`;
  });

  lines.push("");
  let summary = `${s.green(`${result.built.length} built`)}${s.dim(`, ${result.reused.length} reused`)}`;
  if (result.rejected.length > 0) summary += s.red(`, ${result.rejected.length} rejected`);
  lines.push(summary);
  return lines.join("\n");
}

/** `md cost` — per-target token/$ estimate table and an upper-bound total. */
export function renderCost(cost: BuildCost, s: Styler): string {
  if (cost.targets.length === 0) return "No targets defined.";

  const nameWidth = Math.max(6, ...cost.targets.map((t) => t.target.length));
  const header =
    s.dim(padCell("Target", nameWidth)) +
    GAP +
    s.dim(padCell("Step", 10) + padCell("Calls", 7) + padCell("Input", 8) + padCell("Max out", 9) + "Est. cost");
  const lines = [header, s.dim("─".repeat(nameWidth + GAP.length + 10 + 7 + 8 + 9 + 9))];

  for (const t of cost.targets) {
    const priced = t.stale && t.calls > 0;
    const costText = priced ? s.yellow(formatUsd(t.costUsd)) : s.dim(formatUsd(t.costUsd));
    const name = t.stale ? t.target : s.dim(t.target);
    lines.push(
      padCell(name, nameWidth) +
        GAP +
        padCell(t.step, 10) +
        padCell(String(t.calls), 7) +
        padCell(formatTokens(t.inputTokens), 8) +
        padCell(formatTokens(t.maxOutputTokens), 9) +
        costText,
    );
  }

  const staleModel = cost.targets.filter((t) => t.stale && t.calls > 0).length;
  lines.push("");
  lines.push(
    `${s.bold("Estimated upper bound:")} ${s.yellow(formatUsd(cost.totalCostUsd))}` +
      s.dim(` across ${staleModel} stale target(s) that would run`),
  );
  lines.push(s.dim("  input priced from rendered prompts; output assumes the max_tokens cap"));
  if (cost.hasUnpriced) {
    lines.push(s.yellow("  ⚠ some targets use a model with no known pricing (shown as —)"));
  }
  return lines.join("\n");
}

export interface WhyView {
  readonly name: string;
  readonly id: string;
  readonly stale: boolean;
  readonly step: string;
  readonly cache: string;
  readonly inputs: readonly ResolvedInput[];
  readonly samples?: { readonly have: number; readonly want: number };
  readonly provenance?: Provenance;
}

/** `md why` — full provenance for a target's artifact. */
export function renderWhy(v: WhyView, s: Styler): string {
  const label = (text: string): string => s.dim(padCell(text, 9));
  const lines: string[] = [];
  lines.push(`${label("target")}${s.bold(v.name)}`);
  lines.push(`${label("id")}${s.dim(v.id)}`);
  lines.push(`${label("state")}${v.stale ? s.yellow("stale (not built)") : s.green("fresh")}`);
  lines.push(`${label("step")}${v.step}`);
  const cacheText = v.samples ? `${v.cache} ${s.dim(`(${v.samples.have}/${v.samples.want} samples)`)}` : v.cache;
  lines.push(`${label("cache")}${cacheText}`);

  lines.push(s.dim("inputs:"));
  if (v.inputs.length === 0) {
    lines.push(`  ${s.dim("(none)")}`);
  }
  for (const i of v.inputs) {
    const kind = i.kind === "target" ? s.cyan(`[${i.kind}]`) : s.dim(`[${i.kind}]`);
    lines.push(`  ${s.dim("-")} ${i.ref} ${kind} ${s.dim(shortHash(i.hash))}`);
  }

  const p = v.provenance;
  if (!p) {
    lines.push("");
    lines.push(s.dim("(no provenance yet — run `md build`)"));
    return lines.join("\n");
  }

  lines.push(s.dim("─── provenance ───"));
  lines.push(`${label("model")}${p.model ?? s.dim("—")}`);
  const tokens = p.tokens ? `in ${p.tokens.input} / out ${p.tokens.output}` : s.dim("—");
  lines.push(`${label("tokens")}${tokens}`);
  lines.push(`${label("cost")}${p.costUsd !== undefined ? formatUsd(p.costUsd) : s.dim("—")}`);
  if (p.durationMs !== undefined) lines.push(`${label("took")}${(p.durationMs / 1000).toFixed(2)}s`);
  lines.push(`${label("made at")}${p.producedAt}`);
  return lines.join("\n");
}
