"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode, TransformNodeData } from "../types";

// transform node — emerald, JSONata expression, no sub-DAG.
export function TransformNodeView({ data, selected }: NodeProps<FlowNode>) {
  const d = data as TransformNodeData;
  // Show first ~32 chars of expression so admins can sanity-check at a glance.
  const preview = d.expression.replace(/\s+/g, " ").slice(0, 32);
  return (
    <div
      className={[
        "min-w-[180px] px-3 py-2 rounded-md bg-surface-container/95 shadow-md",
        "border-2",
        selected ? "border-emerald-400" : "border-emerald-400/50",
      ].join(" ")}
      style={{ boxShadow: selected ? "0 0 0 1px rgb(52 211 153 / 0.4)" : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!bg-emerald-400 !border-emerald-400" />
      <div className="font-label text-[9px] tracking-[0.25em] uppercase mb-1" style={{ color: "rgb(52 211 153)" }}>
        transform · jsonata
      </div>
      <div className="text-[12px] text-on-surface truncate">{d.nodeId}</div>
      <div className="text-[10px] text-on-surface-variant font-mono truncate">{preview || "$"}</div>
      <Handle type="source" position={Position.Right} className="!bg-emerald-400 !border-emerald-400" />
    </div>
  );
}
