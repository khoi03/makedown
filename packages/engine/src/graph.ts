/**
 * Build-graph construction: classify each target's inputs into dependencies
 * (other targets) vs sources (files), then topologically order the targets.
 */
import { bareRef } from "@makedown/format";
import type { BuildDoc, TargetBlock } from "@makedown/shared";

export interface GraphNode {
  readonly target: TargetBlock;
  /** Names of other targets this target depends on. */
  readonly deps: readonly string[];
  /** Source-file refs (relative paths) this target depends on. */
  readonly sources: readonly string[];
}

export interface BuildGraph {
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** Target names in a valid execution order (dependencies first). */
  readonly order: readonly string[];
}

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphError";
  }
}

export function buildGraph(doc: BuildDoc): BuildGraph {
  const names = new Set(doc.targets.map((t) => t.name));
  const nodes = new Map<string, GraphNode>();

  for (const target of doc.targets) {
    const deps: string[] = [];
    const sources: string[] = [];
    for (const input of target.header.inputs) {
      const ref = bareRef(input);
      if (names.has(ref)) {
        deps.push(ref);
      } else {
        sources.push(ref);
      }
    }
    nodes.set(target.name, { target, deps, sources });
  }

  return { nodes, order: topoSort(nodes) };
}

function topoSort(nodes: ReadonlyMap<string, GraphNode>): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (name: string, path: readonly string[]): void => {
    const status = state.get(name);
    if (status === "done") return;
    if (status === "visiting") {
      throw new GraphError(`Dependency cycle: ${[...path, name].join(" -> ")}`);
    }
    state.set(name, "visiting");
    const node = nodes.get(name);
    if (node) {
      for (const dep of node.deps) {
        visit(dep, [...path, name]);
      }
    }
    state.set(name, "done");
    order.push(name);
  };

  for (const name of nodes.keys()) {
    visit(name, []);
  }
  return order;
}
