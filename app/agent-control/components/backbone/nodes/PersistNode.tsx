"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode, PersistNodeData } from "../types";

// persist node — amber-400, runtime data-persistence primitive. Writes
// { relicSlug, kind, base64, contentType?, ext? } to private/relics/<slug>/
// derived/ in-process. Output: { savedPath, absPath, bytes, contentType }.
export function PersistNodeView({ data, selected }: NodeProps<FlowNode>) {
  const d = data as PersistNodeData;
  return (
    <div
      className={[
        "min-w-[180px] px-3 py-2 rounded-md bg-surface-container/95 shadow-md",
        "border-2",
        selected ? "border-amber-400" : "border-amber-400/50",
      ].join(" ")}
      style={{ boxShadow: selected ? "0 0 0 1px rgb(251 191 36 / 0.4)" : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-400 !border-amber-400" />
      <div
        className="font-label text-[9px] tracking-[0.25em] uppercase mb-1 flex items-center gap-1"
        style={{ color: "rgb(251 191 36)" }}
      >
        <span className="material-symbols-outlined text-[12px] leading-none">save</span>
        persist · file
      </div>
      <div className="text-[12px] text-on-surface truncate">{d.nodeId}</div>
      <div className="text-[10px] text-on-surface-variant font-mono truncate">→ derived/</div>
      <Handle type="source" position={Position.Right} className="!bg-amber-400 !border-amber-400" />
    </div>
  );
}
