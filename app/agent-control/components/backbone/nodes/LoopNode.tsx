"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode, LoopNodeData } from "../types";

// Loop node — visually distinct (violet, double border) so admins
// recognize "this is a black box that runs a sub-DAG up to N times".
// Body is opaque on the main canvas; click panel "Edit loop body" to
// open the nested sub-canvas modal.
export function LoopNodeView({ data, selected }: NodeProps<FlowNode>) {
  const d = data as LoopNodeData;
  const bodyCount = d.body.nodes.length;
  return (
    <div
      className={[
        "min-w-[180px] px-3 py-2 rounded-md bg-surface-container/95 shadow-md",
        "border-2 border-double",
        selected ? "border-violet-300" : "border-violet-300/50",
      ].join(" ")}
      style={{ boxShadow: selected ? "0 0 0 1px rgb(196 181 253 / 0.4)" : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!bg-violet-300 !border-violet-300" />
      <div className="font-label text-[9px] tracking-[0.25em] uppercase mb-1" style={{ color: "rgb(196 181 253)" }}>
        Loop · iter≤{d.maxIterations}
      </div>
      <div className="text-[12px] text-on-surface truncate">{d.nodeId}</div>
      <div className="text-[10px] text-on-surface-variant truncate">
        body: {bodyCount} node{bodyCount === 1 ? "" : "s"}
        {d.exitWhen.length > 0 ? ` · exitWhen ×${d.exitWhen.length}` : ""}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-violet-300 !border-violet-300" />
    </div>
  );
}
