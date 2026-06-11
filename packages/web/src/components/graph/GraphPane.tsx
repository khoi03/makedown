/**
 * The live DAG. Derives React Flow nodes/edges from the graph via the pure
 * layout, badges each node with its live build status, and surfaces selection
 * to drive the inspector.
 */
import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutGraph } from "../../lib/graph-layout.js";
import type { GraphView } from "../../lib/types.js";
import type { StatusMap } from "../../lib/build-status.js";
import { TargetNode, type TargetNodeData } from "./TargetNode.js";
import "./graph.css";

const nodeTypes: NodeTypes = { target: TargetNode };

export interface GraphPaneProps {
  readonly graph: GraphView | undefined;
  readonly statuses: StatusMap;
  readonly selected: string | undefined;
  readonly onSelect: (target: string) => void;
}

export function GraphPane({ graph, statuses, selected, onSelect }: GraphPaneProps) {
  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };
    const laid = layoutGraph(graph);
    const nodes: Node[] = laid.nodes.map((n) => ({
      id: n.id,
      type: "target",
      position: n.position,
      data: {
        target: n.data.target,
        status: statuses[n.id],
        selected: n.id === selected,
      } satisfies TargetNodeData,
    }));
    const edges: Edge[] = laid.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: statuses[e.target] === "building",
    }));
    return { nodes, edges };
  }, [graph, statuses, selected]);

  if (!graph || graph.targets.length === 0) {
    return <div className="graph-empty">No targets yet. Define one in build.md.</div>;
  }

  return (
    <div className="graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelect(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-subtle)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
