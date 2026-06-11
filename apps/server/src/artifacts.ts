/**
 * Read-side services: the build graph, compiled artifacts + their provenance,
 * and cost estimates — everything the web UI needs to *view* a workspace. All
 * plan-only (no provider, no model calls); content is read from the CAS by the
 * target's current identity hash, so a stale recipe reports "not built".
 */
import { join } from "node:path";
import {
  planBuild,
  estimateBuildCost,
  LocalCas,
  type BuildContext,
  type BuildCost,
} from "@makedown/engine";
import type { Provenance, ResolvedInput, StepType } from "@makedown/shared";
import { loadDoc } from "./workspace.js";

/** A serializable view of one graph node for the DAG UI. */
export interface GraphTargetView {
  readonly name: string;
  readonly step: StepType;
  readonly stale: boolean;
  readonly id: string;
  readonly output: string;
  readonly deps: readonly string[];
  readonly inputs: readonly ResolvedInput[];
}

export interface GraphView {
  /** Target names in execution order (dependencies first). */
  readonly order: readonly string[];
  readonly targets: readonly GraphTargetView[];
}

/** A built artifact: its decoded text plus provenance. */
export interface ArtifactView {
  readonly target: string;
  readonly content: string;
  readonly provenance: Provenance;
}

/** A plan-only context: just the workspace + CAS, no provider. */
function planContext(dir: string): BuildContext {
  return { workspaceDir: dir, cas: new LocalCas(join(dir, ".makedown")) };
}

/** Resolve a target's current identity hash, throwing if the target is unknown. */
async function targetId(dir: string, target: string): Promise<{ id: string; cas: LocalCas }> {
  const doc = await loadDoc(dir);
  if (!doc.targets.some((t) => t.name === target)) {
    throw new Error(`Unknown target: ${target}`);
  }
  const ctx = planContext(dir);
  const plan = await planBuild(doc, ctx);
  const id = plan.ids.get(target);
  if (!id) throw new Error(`Unknown target: ${target}`);
  return { id, cas: ctx.cas as LocalCas };
}

/** Build the graph view (stale flags, deps, step, output) for the DAG UI. */
export async function getGraph(dir: string): Promise<GraphView> {
  const doc = await loadDoc(dir);
  const byName = new Map(doc.targets.map((t) => [t.name, t] as const));
  const plan = await planBuild(doc, planContext(dir));
  const targets = plan.targets.map((tp): GraphTargetView => {
    const target = byName.get(tp.name);
    return {
      name: tp.name,
      step: target?.header.step ?? "chat",
      stale: tp.stale,
      id: tp.id,
      output: target?.header.output ?? "",
      deps: plan.graph.nodes.get(tp.name)?.deps ?? [],
      inputs: tp.inputs,
    };
  });
  return { order: plan.graph.order, targets };
}

/** Read a built artifact's content + provenance, or `undefined` if not built. */
export async function getArtifact(dir: string, target: string): Promise<ArtifactView | undefined> {
  const { id, cas } = await targetId(dir, target);
  const content = await cas.get(id);
  if (!content) return undefined;
  const provenance = await cas.getProvenance(id);
  if (!provenance) return undefined;
  return { target, content: new TextDecoder().decode(content), provenance };
}

/** Read a target's provenance (`md why`), or `undefined` if not built. */
export async function getProvenance(dir: string, target: string): Promise<Provenance | undefined> {
  const { id, cas } = await targetId(dir, target);
  return cas.getProvenance(id);
}

/** Estimate the cost of building the currently-stale model targets. */
export async function getCost(dir: string): Promise<BuildCost> {
  const doc = await loadDoc(dir);
  return estimateBuildCost(doc, planContext(dir));
}
