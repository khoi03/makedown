/**
 * Pure layered layout for the DAG view: assign each target a layer (longest path
 * from a root) and a row within that layer, then emit React Flow nodes + edges.
 * Kept pure (no React, no DOM) so it is trivially testable and cheap to recompute.
 */
import type { GraphView, GraphTargetView } from "./types.js";

export interface FlowNodeData {
  readonly target: GraphTargetView;
  readonly layer: number;
}

export interface FlowNode {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly data: FlowNodeData;
}

export interface FlowEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface FlowGraph {
  readonly nodes: FlowNode[];
  readonly edges: FlowEdge[];
}

export interface LayoutOptions {
  readonly columnWidth?: number;
  readonly rowHeight?: number;
}

const DEFAULT_COLUMN_WIDTH = 260;
const DEFAULT_ROW_HEIGHT = 140;

export function layoutGraph(graph: GraphView, opts: LayoutOptions = {}): FlowGraph {
  const columnWidth = opts.columnWidth ?? DEFAULT_COLUMN_WIDTH;
  const rowHeight = opts.rowHeight ?? DEFAULT_ROW_HEIGHT;

  const byName = new Map(graph.targets.map((t) => [t.name, t] as const));
  const layer = new Map<string, number>();

  // `order` is topological, so a target's deps already have a layer assigned.
  for (const name of graph.order) {
    const target = byName.get(name);
    if (!target) continue;
    const depLayers = target.deps.map((d) => layer.get(d) ?? 0);
    layer.set(name, depLayers.length === 0 ? 0 : Math.max(...depLayers) + 1);
  }

  const rowCursor = new Map<number, number>();
  const nodes: FlowNode[] = graph.order.flatMap((name) => {
    const target = byName.get(name);
    if (!target) return [];
    const l = layer.get(name) ?? 0;
    const row = rowCursor.get(l) ?? 0;
    rowCursor.set(l, row + 1);
    return [
      {
        id: name,
        position: { x: l * columnWidth, y: row * rowHeight },
        data: { target, layer: l },
      },
    ];
  });

  const edges: FlowEdge[] = graph.targets.flatMap((t) =>
    t.deps.map((dep) => ({ id: `${dep}->${t.name}`, source: dep, target: t.name })),
  );

  return { nodes, edges };
}
