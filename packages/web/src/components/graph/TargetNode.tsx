import { Handle, Position, type NodeProps } from "@xyflow/react";
import { StatusBadge } from "../ui/StatusBadge.js";
import type { GraphTargetView, TargetRunStatus } from "../../lib/types.js";

export interface TargetNodeData extends Record<string, unknown> {
  readonly target: GraphTargetView;
  readonly status?: TargetRunStatus;
  readonly selected?: boolean;
}

/** A DAG node: target name, step, and live build status. */
export function TargetNode({ data }: NodeProps) {
  const { target, status, selected } = data as TargetNodeData;
  return (
    <div className="target-node" data-step={target.step} data-selected={selected ? "" : undefined}>
      <Handle type="target" position={Position.Left} />
      <div className="target-node__head">
        <span className="target-node__name">{target.name}</span>
        <span className="target-node__step mono">{target.step}</span>
      </div>
      <div className="target-node__foot">
        <StatusBadge status={status} stale={target.stale} />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
