"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import type { FlowEdge } from "../types";

export function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<FlowEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "var(--md-sys-color-primary, #90decd)" : "rgba(144, 222, 205, 0.5)",
          strokeWidth: selected ? 2 : 1.5,
        }}
      />
      {data?.when ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="px-2 py-0.5 bg-surface-container border border-tertiary/60 rounded text-[10px] text-tertiary font-label tracking-[0.1em] uppercase"
          >
            {data.when}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
