"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { BranchNodeData, FlowNode } from "../types";

export function BranchNodeView({ data, selected }: NodeProps<FlowNode>) {
  const d = data as BranchNodeData;
  const summary = d.cases[0]
    ? `${d.cases[0].path || "(root)"} ${d.cases[0].op} ${
        d.cases[0].op === "exists" ? "" : JSON.stringify(d.cases[0].value)
      }`
    : "(no cases)";
  return (
    <div
      className={[
        "min-w-[180px] px-3 py-2 rounded-md border-2 border-dashed bg-surface-container/95 shadow-md",
        selected ? "border-tertiary" : "border-tertiary/50",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Left} className="!bg-tertiary !border-tertiary" />
      <div className="font-label text-[9px] tracking-[0.25em] uppercase text-tertiary mb-1">
        Branch · {d.cases.length} case{d.cases.length === 1 ? "" : "s"}
      </div>
      <div className="text-[12px] text-on-surface truncate">{d.nodeId}</div>
      <div className="text-[10px] text-on-surface-variant truncate">{summary}</div>
      <Handle type="source" position={Position.Right} className="!bg-tertiary !border-tertiary" />
    </div>
  );
}
