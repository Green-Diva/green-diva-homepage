"use client";

// Decorative BEGIN / AGENT.INPUT / AGENT.OUTPUT / END / AGENT-BOUNDARY
// nodes — auto-injected from agent.boundScenes. Read-only — no panel, no
// edit, no save.
//
// Visual model (matches runtime: one invocation = one input + one output):
//
//   BEGIN_X ─┐                                              ┌─→ END_X
//   BEGIN_Y ─┼─→ AGENT.INPUT ─→ [DAG body] ─→ AGENT.OUTPUT ─┼─→ END_Y
//   BEGIN_Z ─┘   (single convergence)   (single point)     └─→ END_Z
//             ^                                            ^
//             N scenes COULD invoke; runtime sees ONE      output dispatched
//             input value per invocation                   to ONE scene's
//                                                          outputSchema per
//                                                          invocation
//
// BEGIN/END dashed edges = "candidate relationship" (N possibilities).
// AGENT.INPUT→root and leaf→AGENT.OUTPUT solid edges = "actual runtime
// data flow" (1 instance per invocation).

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type {
  AgentBoundaryData,
  BeginEndFieldHint,
  BeginNodeData,
  EndNodeData,
  FlowNode,
} from "../types";

function FieldRows({ fields, accent }: { fields: BeginEndFieldHint[]; accent: string }) {
  if (fields.length === 0) {
    return <div className="text-[10px] italic text-on-surface-variant">unknown shape</div>;
  }
  return (
    <ul className="space-y-0.5">
      {fields.slice(0, 8).map((f) => (
        <li key={f.name} className="font-mono text-[10px] flex gap-1.5 text-on-surface">
          <span style={{ color: accent }}>{f.name}</span>
          <span className="text-on-surface-variant">:</span>
          <span className="text-on-surface-variant truncate">{f.type}</span>
          {f.optional ? <span className="text-amber-400">?</span> : null}
        </li>
      ))}
      {fields.length > 8 ? (
        <li className="text-[10px] italic text-on-surface-variant">
          + {fields.length - 8} more
        </li>
      ) : null}
    </ul>
  );
}

export function BeginNodeView({ data }: NodeProps<FlowNode>) {
  const d = data as unknown as BeginNodeData;
  const accent = "rgb(96 165 250)"; // sky-400 — distinct from skill/branch/loop/forEach/transform colors
  const intent = d.via === "intent";
  return (
    <div
      className="min-w-[220px] max-w-[260px] px-3 py-2 rounded-md bg-sky-500/[0.08] shadow-md border-2 border-dashed"
      style={{ borderColor: accent, opacity: intent ? 0.7 : 1 }}
    >
      <div
        className="font-label text-[9px] tracking-[0.25em] uppercase mb-1 flex items-center gap-1.5"
        style={{ color: accent }}
      >
        <span>▶ BEGIN</span>
        <span className="text-[8px] tracking-[0.2em] opacity-70">{d.invocation}</span>
        {intent ? (
          <span className="text-[8px] tracking-[0.2em] text-amber-300/90 border border-amber-300/40 px-1 rounded">
            INTENT
          </span>
        ) : null}
      </div>
      <div className="text-[11px] font-mono text-on-surface mb-0.5">{d.sceneKey}</div>
      <div className="text-[10px] text-on-surface-variant mb-1.5 truncate">{d.sceneLabel}</div>
      <div className="text-[9px] tracking-[0.2em] uppercase text-on-surface-variant mb-0.5">
        ctx → agent.input
      </div>
      <FieldRows fields={d.fields} accent={accent} />
      <Handle
        type="source"
        position={Position.Right}
        className="!border-2"
        style={{ background: accent, borderColor: accent }}
      />
    </div>
  );
}

export function EndNodeView({ data }: NodeProps<FlowNode>) {
  const d = data as unknown as EndNodeData;
  const accent = "rgb(244 114 182)"; // pink-400 — distinct
  const intent = d.via === "intent";
  return (
    <div
      className="min-w-[220px] max-w-[260px] px-3 py-2 rounded-md bg-pink-500/[0.08] shadow-md border-2 border-dashed"
      style={{ borderColor: accent, opacity: intent ? 0.7 : 1 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-2"
        style={{ background: accent, borderColor: accent }}
      />
      <div
        className="font-label text-[9px] tracking-[0.25em] uppercase mb-1 flex items-center gap-1.5"
        style={{ color: accent }}
      >
        <span>■ END</span>
        <span className="text-[8px] tracking-[0.2em] opacity-70">contract</span>
        {intent ? (
          <span className="text-[8px] tracking-[0.2em] text-amber-300/90 border border-amber-300/40 px-1 rounded">
            INTENT
          </span>
        ) : null}
      </div>
      <div className="text-[11px] font-mono text-on-surface mb-0.5">{d.sceneKey}</div>
      <div className="text-[10px] text-on-surface-variant mb-1.5 truncate">{d.sceneLabel}</div>
      <div className="text-[9px] tracking-[0.2em] uppercase text-on-surface-variant mb-0.5">
        leaf.output → scene.outputSchema
      </div>
      <FieldRows fields={d.fields} accent={accent} />
    </div>
  );
}

// AgentInputNodeView — single convergence point all BEGIN scenes funnel
// into. Solid sky-400 border (vs BEGIN's dashed) to signal "actual data
// flow point" rather than "candidate scene relationship".
export function AgentInputNodeView() {
  const accent = "rgb(96 165 250)"; // sky-400
  return (
    <div
      className="min-w-[140px] px-3 py-2 rounded-md bg-sky-500/[0.12] shadow-md border-2"
      style={{ borderColor: accent }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-2"
        style={{ background: accent, borderColor: accent }}
      />
      <div
        className="font-label text-[9px] tracking-[0.25em] uppercase mb-1"
        style={{ color: accent }}
      >
        ◆ AGENT.INPUT
      </div>
      <div className="text-[10px] text-on-surface-variant leading-tight">
        single input per invocation
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!border-2"
        style={{ background: accent, borderColor: accent }}
      />
    </div>
  );
}

// AgentOutputNodeView — mirror of AgentInputNodeView. All user-leaves
// funnel here, then fan out (decoratively) to END nodes.
export function AgentOutputNodeView() {
  const accent = "rgb(244 114 182)"; // pink-400
  return (
    <div
      className="min-w-[140px] px-3 py-2 rounded-md bg-pink-500/[0.12] shadow-md border-2"
      style={{ borderColor: accent }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-2"
        style={{ background: accent, borderColor: accent }}
      />
      <div
        className="font-label text-[9px] tracking-[0.25em] uppercase mb-1"
        style={{ color: accent }}
      >
        ◆ AGENT.OUTPUT
      </div>
      <div className="text-[10px] text-on-surface-variant leading-tight">
        single output per invocation
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!border-2"
        style={{ background: accent, borderColor: accent }}
      />
    </div>
  );
}

// AgentBoundaryView — translucent labeled rectangle wrapping all user
// nodes. Pure visual — no handles, not clickable, not selectable. Sized
// to the user-nodes bounding box (computed in buildIoNodes) with extra
// padding so admin sees the agent as a single封装 unit. Header label
// "AGENT: <codename>" reinforces the boundary semantically.
export function AgentBoundaryView({ data }: NodeProps<FlowNode>) {
  const d = data as unknown as AgentBoundaryData;
  return (
    <div
      className="w-full h-full rounded-lg border-2 border-dashed border-on-surface-variant/25 bg-on-surface-variant/[0.02] pointer-events-none relative"
      style={{ minWidth: 200, minHeight: 100 }}
    >
      <div className="absolute -top-3 left-4 px-2 py-0.5 bg-background/80 text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded">
        AGENT · {d.codename}
      </div>
    </div>
  );
}
