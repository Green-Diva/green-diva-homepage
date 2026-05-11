"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode, ForEachNodeData } from "../types";

// forEach node — sky-blue, body sub-DAG runs once per item in input array.
export function ForEachNodeView({ data, selected }: NodeProps<FlowNode>) {
  const d = data as ForEachNodeData;
  const bodyCount = d.body.nodes.length;
  return (
    <div
      className={[
        "min-w-[180px] px-3 py-2 rounded-md bg-surface-container/95 shadow-md",
        "border-2",
        selected ? "border-sky-400" : "border-sky-400/50",
      ].join(" ")}
      style={{ boxShadow: selected ? "0 0 0 1px rgb(56 189 248 / 0.4)" : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!bg-sky-400 !border-sky-400" />
      <div className="font-label text-[9px] tracking-[0.25em] uppercase mb-1" style={{ color: "rgb(56 189 248)" }}>
        forEach · max {d.maxItems}
      </div>
      <div className="text-[12px] text-on-surface truncate">{d.nodeId}</div>
      <div className="text-[10px] text-on-surface-variant truncate">
        body: {bodyCount} node{bodyCount === 1 ? "" : "s"} · {d.aggregate}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-sky-400 !border-sky-400" />
    </div>
  );
}
