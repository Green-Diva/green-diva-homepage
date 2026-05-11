"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode, SkillNodeData } from "../types";

export function SkillNodeView({ data, selected }: NodeProps<FlowNode>) {
  const d = data as SkillNodeData;
  return (
    <div
      className={[
        "min-w-[160px] px-3 py-2 rounded-md border bg-surface-container/95 shadow-md",
        selected ? "border-secondary" : "border-secondary/40",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Left} className="!bg-secondary !border-secondary" />
      <div className="font-label text-[9px] tracking-[0.25em] uppercase text-secondary mb-1">
        Skill · Slot {d.slotIndex}
      </div>
      <div className="text-[12px] text-on-surface truncate">{d.nodeId}</div>
      <Handle type="source" position={Position.Right} className="!bg-secondary !border-secondary" />
    </div>
  );
}
