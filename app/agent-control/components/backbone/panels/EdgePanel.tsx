"use client";

import type { FlowEdge, FlowNode } from "../types";

export function EdgePanel({
  edge,
  sourceNode,
  onChangeWhen,
}: {
  edge: FlowEdge;
  sourceNode: FlowNode | null;
  onChangeWhen: (when: string | undefined) => void;
}) {
  const branchLabels =
    sourceNode?.data.type === "branch"
      ? Array.from(
          new Set(
            sourceNode.data.cases
              .map((c) => c.label)
              .concat(sourceNode.data.defaultLabel ? [sourceNode.data.defaultLabel] : []),
          ),
        )
      : [];

  return (
    <div className="space-y-3">
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary mb-1">
          Edge
        </div>
        <div className="text-[12px] text-on-surface-variant">
          {edge.source} → {edge.target}
        </div>
      </div>
      {branchLabels.length > 0 ? (
        <div>
          <div className="font-label text-[9px] tracking-[0.3em] uppercase text-tertiary mb-1">
            When (case label)
          </div>
          <select
            value={edge.data?.when ?? ""}
            onChange={(e) => onChangeWhen(e.target.value || undefined)}
            className="w-full bg-background/60 border border-tertiary/30 px-2 py-1 text-[12px] text-on-surface"
          >
            {branchLabels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="text-[11px] text-on-surface-variant">
          Plain edge (source is a skill node — always live).
        </div>
      )}
    </div>
  );
}
