"use client";

// Backbone DAG editor (Phase 5, 2026-05-09; Phase 8 R2 — loop UI 2026-05-10).
//
// React Flow canvas for editing pipelineConfig v2. Replaces the linear-list
// BackboneEditor. Supports three node types — skill (run a Skill from a
// slot), branch (route by condition on prior output), loop (run a body
// sub-DAG up to maxIterations) — and edges that may carry a `when` label
// when their source is a branch.
//
// Loop / forEach bodies are edited in a nested modal sub-canvas (BodySubCanvasEditor) —
// the body is persisted as schema-shape `{ nodes, edges }` on the loop
// node's data, opened on demand. UI does not allow nesting a loop inside
// a loop body (runtime allows depth 2 but admin must use Advanced raw
// JSON for that — keeps the editor simple).
//
// On open: v1 configs are upconverted to a linear v2 graph for editing; on
// save we always write v2. v1 → v2 happens both here (for the canvas) and
// in the runtime, kept in sync.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeProps,
  type EdgeProps,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentRow, EquipRow } from "../types";

// — — Domain types (mirror lib/skills/runtime/backbone.ts shapes) — — — — —

type SourceRef = string | { merge: Record<string, string> };

type BranchCase = {
  path: string;
  op: "eq" | "ne" | "in" | "exists";
  value?: unknown;
  label: string;
};

type SkillNodeData = {
  type: "skill";
  nodeId: string;
  equipSlot: number;
  inputFrom: SourceRef;
};

type BranchNodeData = {
  type: "branch";
  nodeId: string;
  inputFrom: SourceRef;
  cases: BranchCase[];
  defaultLabel?: string;
};

// Persisted body shape, mirrors lib/skills/runtime/backbone.ts loop body.
// Body nodes only ever store skill / branch — UI doesn't allow nested
// loops here (runtime supports depth 2 via Advanced raw JSON only).
// Body sub-DAG can contain skill / branch / transform — but NOT loop or
// forEach (UI doesn't show nested sub-canvases; runtime supports
// MAX_LOOP_DEPTH=2 only via raw-JSON Advanced editor).
type BodyNodeData = SkillNodeData | BranchNodeData | TransformNodeData;
type BodyEdge = { from: string; to: string; when?: string };

type LoopNodeData = {
  type: "loop";
  nodeId: string;
  inputFrom: SourceRef;
  maxIterations: number;
  exitWhen: BranchCase[];
  aggregate: "last" | "concat-array";
  body: { nodes: BodyNodeData[]; edges: BodyEdge[]; positions?: Record<string, { x: number; y: number }> };
};

type ForEachNodeData = {
  type: "forEach";
  nodeId: string;
  inputFrom: SourceRef;
  maxItems: number;
  aggregate: "last" | "concat-array";
  body: { nodes: BodyNodeData[]; edges: BodyEdge[]; positions?: Record<string, { x: number; y: number }> };
};

type TransformNodeData = {
  type: "transform";
  nodeId: string;
  inputFrom: SourceRef;
  expression: string;
};

type NodeData = SkillNodeData | BranchNodeData | LoopNodeData | ForEachNodeData | TransformNodeData;
type FlowNode = Node<NodeData>;

type EdgeData = { when?: string };
type FlowEdge = Edge<EdgeData>;

// — — Conversion: persisted config ⇄ react-flow nodes/edges — — — — — — — —

const SLOT_COUNT = 6;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function autoLayout(
  nodes: Array<{ id: string; data: NodeData; storedPos?: { x: number; y: number } }>,
  edges: Array<{ from: string; to: string }>,
): Map<string, { x: number; y: number }> {
  // Topological levels → x; intra-level order → y. Cheap and good enough for
  // the few-dozen-node workflows this editor targets.
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    adj.get(e.from)?.push(e.to);
  }
  const level = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) {
    queue.push(id);
    level.set(id, 0);
  }
  while (queue.length) {
    const id = queue.shift()!;
    const lvl = level.get(id) ?? 0;
    for (const next of adj.get(id) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, lvl + 1));
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  const byLevel = new Map<number, string[]>();
  for (const n of nodes) {
    const lvl = level.get(n.id) ?? 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(n.id);
  }
  const out = new Map<string, { x: number; y: number }>();
  const X_GAP = 280;
  const Y_GAP = 140;
  for (const n of nodes) {
    if (n.storedPos) {
      out.set(n.id, n.storedPos);
      continue;
    }
    const lvl = level.get(n.id) ?? 0;
    const peers = byLevel.get(lvl) ?? [];
    const idx = peers.indexOf(n.id);
    out.set(n.id, {
      x: 60 + lvl * X_GAP,
      y: 40 + idx * Y_GAP,
    });
  }
  return out;
}

function loadConfig(cfg: unknown): {
  nodes: FlowNode[];
  edges: FlowEdge[];
  warning: string | null;
} {
  if (cfg == null) return { nodes: [], edges: [], warning: null };
  if (!isObject(cfg)) {
    return { nodes: [], edges: [], warning: "Existing config has unknown shape — saving here will replace it." };
  }
  const c = cfg as Record<string, unknown>;
  let v2: { nodes: NodeData[]; edges: Array<{ from: string; to: string; when?: string }>; positions: Map<string, { x: number; y: number }> } | null = null;

  if (c.version === 2 && Array.isArray(c.nodes) && Array.isArray(c.edges)) {
    const nodeData: NodeData[] = [];
    const positions = new Map<string, { x: number; y: number }>();
    for (const raw of c.nodes) {
      if (!isObject(raw)) continue;
      const id = typeof raw.id === "string" ? raw.id : null;
      if (!id) continue;
      const inputFrom = parseInputFrom(raw.inputFrom) ?? "agent.input";
      if (raw.type === "skill") {
        const slot = typeof raw.equipSlot === "number" ? raw.equipSlot : 0;
        nodeData.push({ type: "skill", nodeId: id, equipSlot: slot, inputFrom });
      } else if (raw.type === "branch") {
        nodeData.push({
          type: "branch",
          nodeId: id,
          inputFrom,
          cases: parseCases(raw.cases),
          defaultLabel: typeof raw.defaultLabel === "string" ? raw.defaultLabel : undefined,
        });
      } else if (raw.type === "loop") {
        const max = typeof raw.maxIterations === "number" ? raw.maxIterations : 3;
        const aggregate: LoopNodeData["aggregate"] =
          raw.aggregate === "concat-array" ? "concat-array" : "last";
        const exitWhen = Array.isArray(raw.exitWhen) ? parseCases(raw.exitWhen) : [];
        const body = parseBody(raw.body);
        nodeData.push({
          type: "loop",
          nodeId: id,
          inputFrom,
          maxIterations: max,
          aggregate,
          exitWhen,
          body,
        });
      } else if (raw.type === "forEach") {
        const max = typeof raw.maxItems === "number" ? raw.maxItems : 10;
        const aggregate: ForEachNodeData["aggregate"] =
          raw.aggregate === "last" ? "last" : "concat-array";
        const body = parseBody(raw.body);
        nodeData.push({
          type: "forEach",
          nodeId: id,
          inputFrom,
          maxItems: max,
          aggregate,
          body,
        });
      } else if (raw.type === "transform") {
        const expression = typeof raw.expression === "string" ? raw.expression : "$";
        nodeData.push({ type: "transform", nodeId: id, inputFrom, expression });
      }
      if (isObject(raw.position) && typeof raw.position.x === "number" && typeof raw.position.y === "number") {
        positions.set(id, { x: raw.position.x, y: raw.position.y });
      }
    }
    const edgeData = (c.edges as unknown[])
      .filter(isObject)
      .map((e) => ({
        from: typeof e.from === "string" ? e.from : "",
        to: typeof e.to === "string" ? e.to : "",
        when: typeof e.when === "string" ? e.when : undefined,
      }))
      .filter((e) => e.from && e.to);
    v2 = { nodes: nodeData, edges: edgeData, positions };
  } else if (c.version === 1 && Array.isArray(c.steps)) {
    // v1 → linear v2 chain
    const nodeData: NodeData[] = [];
    const edgeData: Array<{ from: string; to: string; when?: string }> = [];
    for (const raw of c.steps) {
      if (!isObject(raw)) continue;
      const id = typeof raw.id === "string" ? raw.id : "";
      const slot = typeof raw.equipSlot === "number" ? raw.equipSlot : 0;
      const m = isObject(raw.inputMapping) ? raw.inputMapping : {};
      const fromStr = typeof m.from === "string" ? m.from : "agent.input";
      nodeData.push({ type: "skill", nodeId: id, equipSlot: slot, inputFrom: fromStr });
      const dep = parseDep(fromStr);
      if (dep) edgeData.push({ from: dep, to: id });
    }
    v2 = { nodes: nodeData, edges: edgeData, positions: new Map() };
  } else {
    return { nodes: [], edges: [], warning: "Existing config is from a previous era — saving here will replace it." };
  }

  const positions = autoLayout(
    v2.nodes.map((n) => ({ id: n.nodeId, data: n, storedPos: v2!.positions.get(n.nodeId) })),
    v2.edges,
  );
  const nodes: FlowNode[] = v2.nodes.map((nd) => ({
    id: nd.nodeId,
    type:
      nd.type === "skill"
        ? "skillNode"
        : nd.type === "branch"
          ? "branchNode"
          : nd.type === "loop"
            ? "loopNode"
            : nd.type === "forEach"
              ? "forEachNode"
              : "transformNode",
    position: positions.get(nd.nodeId) ?? { x: 0, y: 0 },
    data: nd,
  }));
  const edges: FlowEdge[] = v2.edges.map((e, i) => ({
    id: `e${i}-${e.from}-${e.to}-${e.when ?? "_"}`,
    source: e.from,
    target: e.to,
    type: "labeled",
    data: { when: e.when },
    label: e.when,
  }));
  return { nodes, edges, warning: null };
}

function parseCases(raw: unknown): BranchCase[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map((c) => ({
    path: typeof c.path === "string" ? c.path : "",
    op: typeof c.op === "string" ? (c.op as BranchCase["op"]) : "eq",
    value: c.value,
    label: typeof c.label === "string" ? c.label : "match",
  }));
}

function parseBody(raw: unknown): LoopNodeData["body"] {
  const empty: LoopNodeData["body"] = { nodes: [], edges: [], positions: {} };
  if (!isObject(raw)) return empty;
  const positions: Record<string, { x: number; y: number }> = {};
  const nodes: BodyNodeData[] = [];
  if (Array.isArray(raw.nodes)) {
    for (const n of raw.nodes) {
      if (!isObject(n)) continue;
      const id = typeof n.id === "string" ? n.id : null;
      if (!id) continue;
      const inputFrom = parseInputFrom(n.inputFrom) ?? "agent.input";
      if (n.type === "skill") {
        nodes.push({
          type: "skill",
          nodeId: id,
          equipSlot: typeof n.equipSlot === "number" ? n.equipSlot : 0,
          inputFrom,
        });
      } else if (n.type === "branch") {
        nodes.push({
          type: "branch",
          nodeId: id,
          inputFrom,
          cases: parseCases(n.cases),
          defaultLabel: typeof n.defaultLabel === "string" ? n.defaultLabel : undefined,
        });
      } else if (n.type === "transform") {
        nodes.push({
          type: "transform",
          nodeId: id,
          inputFrom,
          expression: typeof n.expression === "string" ? n.expression : "$",
        });
      }
      // loop / forEach nodes inside body are silently dropped — UI can't
      // render nested sub-canvases; admin who wants them must use the
      // Advanced raw-JSON editor (runtime still supports MAX_LOOP_DEPTH=2).
      if (isObject(n.position) && typeof n.position.x === "number" && typeof n.position.y === "number") {
        positions[id] = { x: n.position.x, y: n.position.y };
      }
    }
  }
  const edges: BodyEdge[] = [];
  if (Array.isArray(raw.edges)) {
    for (const e of raw.edges) {
      if (!isObject(e)) continue;
      const from = typeof e.from === "string" ? e.from : "";
      const to = typeof e.to === "string" ? e.to : "";
      if (!from || !to) continue;
      edges.push({ from, to, when: typeof e.when === "string" ? e.when : undefined });
    }
  }
  return { nodes, edges, positions };
}

function parseInputFrom(raw: unknown): SourceRef | null {
  if (typeof raw === "string") {
    if (raw === "agent.input" || /^[a-zA-Z0-9_-]+\.output$/.test(raw)) return raw;
    return null;
  }
  if (isObject(raw) && isObject(raw.merge)) {
    const merge: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.merge)) {
      if (typeof v === "string") merge[k] = v;
    }
    return { merge };
  }
  return null;
}

function parseDep(fromStr: string): string | null {
  if (fromStr === "agent.input") return null;
  const m = fromStr.match(/^([a-zA-Z0-9_-]+)\.output$/);
  return m ? m[1] : null;
}

function serializeBody(body: LoopNodeData["body"]): {
  nodes: unknown[];
  edges: unknown[];
} {
  const positions = body.positions ?? {};
  return {
    nodes: body.nodes.map((nd) => {
      const pos = positions[nd.nodeId];
      const base = pos
        ? { position: { x: Math.round(pos.x), y: Math.round(pos.y) } }
        : {};
      if (nd.type === "skill") {
        return {
          id: nd.nodeId,
          type: "skill" as const,
          equipSlot: nd.equipSlot,
          inputFrom: nd.inputFrom,
          ...base,
        };
      }
      if (nd.type === "branch") {
        return {
          id: nd.nodeId,
          type: "branch" as const,
          inputFrom: nd.inputFrom,
          cases: nd.cases,
          defaultLabel: nd.defaultLabel,
          ...base,
        };
      }
      // transform
      return {
        id: nd.nodeId,
        type: "transform" as const,
        inputFrom: nd.inputFrom,
        expression: nd.expression,
        ...base,
      };
    }),
    edges: body.edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.when ? { when: e.when } : {}),
    })),
  };
}

function buildConfig(nodes: FlowNode[], edges: FlowEdge[]) {
  return {
    version: 2 as const,
    nodes: nodes.map((n) => {
      const d = n.data;
      const pos = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      if (d.type === "skill") {
        return {
          id: d.nodeId,
          type: "skill" as const,
          equipSlot: d.equipSlot,
          inputFrom: d.inputFrom,
          position: pos,
        };
      }
      if (d.type === "branch") {
        return {
          id: d.nodeId,
          type: "branch" as const,
          inputFrom: d.inputFrom,
          cases: d.cases,
          defaultLabel: d.defaultLabel,
          position: pos,
        };
      }
      if (d.type === "loop") {
        const body = serializeBody(d.body);
        return {
          id: d.nodeId,
          type: "loop" as const,
          inputFrom: d.inputFrom,
          maxIterations: d.maxIterations,
          ...(d.exitWhen.length > 0 ? { exitWhen: d.exitWhen } : {}),
          ...(d.aggregate !== "last" ? { aggregate: d.aggregate } : {}),
          body,
          position: pos,
        };
      }
      if (d.type === "forEach") {
        const body = serializeBody(d.body);
        return {
          id: d.nodeId,
          type: "forEach" as const,
          inputFrom: d.inputFrom,
          maxItems: d.maxItems,
          ...(d.aggregate !== "concat-array" ? { aggregate: d.aggregate } : {}),
          body,
          position: pos,
        };
      }
      // transform
      return {
        id: d.nodeId,
        type: "transform" as const,
        inputFrom: d.inputFrom,
        expression: d.expression,
        position: pos,
      };
    }),
    edges: edges.map((e) => ({
      from: e.source,
      to: e.target,
      ...(e.data?.when ? { when: e.data.when } : {}),
    })),
  };
}

// — — Custom node components — — — — — — — — — — — — — — — — — — — — — —

function SkillNodeView({ data, selected }: NodeProps<FlowNode>) {
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
        Skill · Slot {d.equipSlot}
      </div>
      <div className="text-[12px] text-on-surface truncate">{d.nodeId}</div>
      <Handle type="source" position={Position.Right} className="!bg-secondary !border-secondary" />
    </div>
  );
}

function BranchNodeView({ data, selected }: NodeProps<FlowNode>) {
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

// Loop node — visually distinct (violet, double border) so admins
// recognize "this is a black box that runs a sub-DAG up to N times".
// Body is opaque on the main canvas; click panel "Edit loop body" to
// open the nested sub-canvas modal.
function LoopNodeView({ data, selected }: NodeProps<FlowNode>) {
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

function LabeledEdge({
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

// forEach node — sky-blue, body sub-DAG runs once per item in input array.
function ForEachNodeView({ data, selected }: NodeProps<FlowNode>) {
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

// transform node — emerald, JSONata expression, no sub-DAG.
function TransformNodeView({ data, selected }: NodeProps<FlowNode>) {
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

const nodeTypes = {
  skillNode: SkillNodeView,
  branchNode: BranchNodeView,
  loopNode: LoopNodeView,
  forEachNode: ForEachNodeView,
  transformNode: TransformNodeView,
};
const edgeTypes = { labeled: LabeledEdge };

// — — Body sub-canvas editor (nested modal) — — — — — — — — — — — — — —
//
// Used by both loop and forEach nodes — same ReactFlow canvas, different
// header copy / iteration semantics. Reuses Skill / Branch / Transform
// node views + panels from the main canvas. Disallows nesting loop /
// forEach further (UI keeps depth bounded; runtime supports
// MAX_LOOP_DEPTH=2 only via the Advanced raw-JSON editor).
//
// Body source-ref scope is independent — `agent.input` inside the body
// resolves at runtime to:
//   - loop:    the iteration's input (first pass = loop's inputFrom;
//              subsequent passes = previous iteration's leaf output)
//   - forEach: { item, index, total } where item is the current array
//              element. Body reads agent.input.item.

type BodySubCanvasKind = "loop" | "forEach";

type BodySubCanvasEditorProps = {
  parentNodeId: string;
  kind: BodySubCanvasKind;
  initialBody: LoopNodeData["body"];
  equipBySlot: Map<number, EquipRow>;
  onCommit: (body: LoopNodeData["body"]) => void;
  onCancel: () => void;
};

function bodyToFlow(body: LoopNodeData["body"]): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const positionsRecord = body.positions ?? {};
  const positionsMap = new Map<string, { x: number; y: number }>();
  for (const [id, pos] of Object.entries(positionsRecord)) positionsMap.set(id, pos);
  const layout = autoLayout(
    body.nodes.map((n) => ({ id: n.nodeId, data: n, storedPos: positionsMap.get(n.nodeId) })),
    body.edges.map((e) => ({ from: e.from, to: e.to })),
  );
  const nodes: FlowNode[] = body.nodes.map((nd) => ({
    id: nd.nodeId,
    type:
      nd.type === "skill"
        ? "skillNode"
        : nd.type === "branch"
          ? "branchNode"
          : "transformNode",
    position: layout.get(nd.nodeId) ?? { x: 0, y: 0 },
    data: nd,
  }));
  const edges: FlowEdge[] = body.edges.map((e, i) => ({
    id: `be${i}-${e.from}-${e.to}-${e.when ?? "_"}`,
    source: e.from,
    target: e.to,
    type: "labeled",
    data: { when: e.when },
    label: e.when,
  }));
  return { nodes, edges };
}

function flowToBody(nodes: FlowNode[], edges: FlowEdge[]): LoopNodeData["body"] {
  const positions: Record<string, { x: number; y: number }> = {};
  const bodyNodes: BodyNodeData[] = [];
  for (const n of nodes) {
    // belt-and-suspenders — UI prevents nesting loop / forEach inside body
    if (n.data.type === "loop" || n.data.type === "forEach") continue;
    bodyNodes.push(n.data as BodyNodeData);
    positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
  }
  const bodyEdges: BodyEdge[] = edges.map((e) => ({
    from: e.source,
    to: e.target,
    ...(e.data?.when ? { when: e.data.when } : {}),
  }));
  return { nodes: bodyNodes, edges: bodyEdges, positions };
}

function BodySubCanvasEditor(props: BodySubCanvasEditorProps) {
  return (
    <ReactFlowProvider>
      <BodySubCanvasEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function BodySubCanvasEditorInner({
  parentNodeId,
  kind,
  initialBody,
  equipBySlot,
  onCommit,
  onCancel,
}: BodySubCanvasEditorProps) {
  const initial = useMemo(() => bodyToFlow(initialBody), [initialBody]);
  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    closeBtnRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as FlowNode[]),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds) as FlowEdge[]),
    [],
  );
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const sourceNode = nodes.find((n) => n.id === conn.source);
      let when: string | undefined;
      if (sourceNode?.data.type === "branch") {
        when = sourceNode.data.cases[0]?.label ?? sourceNode.data.defaultLabel;
      }
      setEdges((eds) =>
        addEdge(
          {
            ...conn,
            type: "labeled",
            data: { when },
            label: when,
            id: `be${Date.now()}-${conn.source}-${conn.target}`,
          } as FlowEdge,
          eds,
        ) as FlowEdge[],
      );
    },
    [nodes],
  );

  function addSkillNode() {
    const id = nextNodeId(nodes, "b");
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "skillNode",
        position: { x: 80 + nds.length * 60, y: 80 + nds.length * 40 },
        data: { type: "skill", nodeId: id, equipSlot: 0, inputFrom: "agent.input" },
      },
    ]);
    setSelectedId(id);
  }
  function addBranchNode() {
    const id = nextNodeId(nodes, "bbr");
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "branchNode",
        position: { x: 80 + nds.length * 60, y: 80 + nds.length * 40 },
        data: {
          type: "branch",
          nodeId: id,
          inputFrom: "agent.input",
          cases: [{ path: "kind", op: "eq", value: "done", label: "done" }],
          defaultLabel: undefined,
        },
      },
    ]);
    setSelectedId(id);
  }
  function addTransformNode() {
    const id = nextNodeId(nodes, "btx");
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "transformNode",
        position: { x: 80 + nds.length * 60, y: 80 + nds.length * 40 },
        data: { type: "transform", nodeId: id, inputFrom: "agent.input", expression: "$" },
      },
    ]);
    setSelectedId(id);
  }
  function deleteSelected() {
    if (selectedEdgeId) {
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      return;
    }
    if (!selectedId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }
  function patchNode(id: string, patch: Partial<NodeData>) {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } as NodeData } : n)),
    );
  }
  function patchEdge(id: string, when: string | undefined) {
    setEdges((eds) =>
      eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, when }, label: when } : e)),
    );
  }
  function renameNode(oldId: string, newId: string) {
    if (!newId || newId === oldId) return;
    if (nodes.some((n) => n.id === newId)) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(newId)) return;
    setNodes((nds) =>
      nds.map((n) => (n.id === oldId ? { ...n, id: newId, data: { ...n.data, nodeId: newId } } : n)),
    );
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        source: e.source === oldId ? newId : e.source,
        target: e.target === oldId ? newId : e.target,
      })),
    );
    setSelectedId(newId);
  }

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;

  function commit() {
    onCommit(flowToBody(nodes, edges));
  }

  const portal = typeof document !== "undefined" ? document.body : null;
  if (!portal) return null;

  return createPortal(
    <div className="fixed inset-0 z-[210] bg-black/85 backdrop-blur-sm flex flex-col">
      <div
        className={`border-b ${kind === "forEach" ? "border-sky-400/40" : "border-violet-300/40"} bg-surface-container/95 px-4 py-3 flex items-center justify-between gap-4`}
      >
        <div>
          <div
            className="font-label text-[10px] tracking-[0.3em] uppercase"
            style={{ color: kind === "forEach" ? "rgb(56 189 248)" : "rgb(196 181 253)" }}
          >
            {kind === "forEach" ? "forEach Body" : "Loop Body"} · {parentNodeId}
          </div>
          <div className="text-[12px] text-on-surface-variant">
            {nodes.length} nodes · {edges.length} edges ·{" "}
            {kind === "forEach"
              ? "`agent.input` = { item, index, total }"
              : "`agent.input` = iteration state (loop input on first pass, prior leaf output after)"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={commit}
            className="px-4 py-1.5 font-label text-[10px] tracking-[0.25em] uppercase"
            style={{
              background: kind === "forEach" ? "rgb(56 189 248)" : "rgb(196 181 253)",
              color: "rgb(30 27 75)",
            }}
          >
            Apply
          </button>
          <button
            type="button"
            ref={closeBtnRef}
            onClick={onCancel}
            className="px-4 py-1.5 border border-on-surface-variant/40 text-on-surface-variant font-label text-[10px] tracking-[0.25em] uppercase hover:text-on-surface"
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          <div className="absolute top-2 left-2 z-10 flex gap-2">
            <button
              type="button"
              onClick={addSkillNode}
              className="px-3 py-1.5 bg-secondary/[0.15] border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase"
            >
              + Skill
            </button>
            <button
              type="button"
              onClick={addBranchNode}
              className="px-3 py-1.5 bg-tertiary/[0.15] border border-tertiary/60 text-tertiary font-label text-[10px] tracking-[0.25em] uppercase"
            >
              + Branch
            </button>
            <button
              type="button"
              onClick={addTransformNode}
              className="px-3 py-1.5 border-2 font-label text-[10px] tracking-[0.25em] uppercase"
              style={{ borderColor: "rgb(52 211 153 / 0.6)", color: "rgb(52 211 153)", background: "rgb(52 211 153 / 0.12)" }}
            >
              + Transform
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={!selectedId && !selectedEdgeId}
              className="px-3 py-1.5 border border-error/60 text-error font-label text-[10px] tracking-[0.25em] uppercase disabled:opacity-40"
            >
              Delete
            </button>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSelectedId(n.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, e) => {
              setSelectedEdgeId(e.id);
              setSelectedId(null);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setSelectedEdgeId(null);
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="rgba(196,181,253,0.12)" />
            <Controls className="!bg-surface-container !border-violet-300/40" />
            <MiniMap
              className="!bg-surface-container !border-violet-300/40"
              nodeColor={(n) => (n.type === "branchNode" ? "rgba(255,180,140,0.6)" : "rgba(233,193,118,0.6)")}
            />
          </ReactFlow>
        </div>

        <aside className="w-[360px] border-l border-violet-300/40 bg-surface-container/95 overflow-y-auto p-4 space-y-4">
          {selectedNode ? (
            <NodePanel
              key={selectedNode.id}
              node={selectedNode}
              allNodes={nodes}
              equipBySlot={equipBySlot}
              onPatch={(patch) => patchNode(selectedNode.id, patch)}
              onRename={(newId) => renameNode(selectedNode.id, newId)}
              onOpenLoopBody={null}
            />
          ) : selectedEdge ? (
            <EdgePanel
              edge={selectedEdge}
              sourceNode={nodes.find((n) => n.id === selectedEdge.source) ?? null}
              onChangeWhen={(when) => patchEdge(selectedEdge.id, when)}
            />
          ) : (
            <div className="text-[12px] text-on-surface-variant">
              Click a node or edge to edit. <code>agent.input</code> inside the body resolves to the
              current iteration state at runtime.
            </div>
          )}
        </aside>
      </div>
    </div>,
    portal,
  );
}

// — — Editor shell — — — — — — — — — — — — — — — — — — — — — — — — — —

function nextNodeId(existing: FlowNode[], prefix: string): string {
  const used = new Set(existing.map((n) => n.id));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

type Props = {
  agent: AgentRow;
  equips: EquipRow[];
  onClose: () => void;
};

type RunLog = Array<{
  stepId: string;
  skillId?: string;
  durationMs: number;
  ok: boolean;
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
  skipped?: boolean;
  branchLabel?: string;
}>;

type TestResult =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; output: unknown; runLog: RunLog; durationMs: number }
  | { kind: "err"; errorCode: string; errorMessage: string; runLog: RunLog };

export default function BackboneFlowEditor({ agent, equips, onClose }: Props) {
  return (
    <ReactFlowProvider>
      <BackboneFlowEditorInner agent={agent} equips={equips} onClose={onClose} />
    </ReactFlowProvider>
  );
}

function BackboneFlowEditorInner({ agent, equips, onClose }: Props) {
  const router = useRouter();

  const initial = useMemo(() => loadConfig(agent.pipelineConfig), [agent.pipelineConfig]);
  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [topErr, setTopErr] = useState<string | null>(initial.warning);
  const [test, setTest] = useState<TestResult>({ kind: "idle" });
  const [sampleInput, setSampleInput] = useState('{ "prompt": "hello" }');
  const [bodyEditorFor, setBodyEditorFor] = useState<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, busy]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as FlowNode[]),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds) as FlowEdge[]),
    [],
  );
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      // Detect if source is a branch — if so, default `when` to the first
      // case label (user can edit via edge panel).
      const sourceNode = nodes.find((n) => n.id === conn.source);
      let when: string | undefined;
      if (sourceNode?.data.type === "branch") {
        when = sourceNode.data.cases[0]?.label ?? sourceNode.data.defaultLabel;
      }
      setEdges((eds) =>
        addEdge(
          {
            ...conn,
            type: "labeled",
            data: { when },
            label: when,
            id: `e${Date.now()}-${conn.source}-${conn.target}`,
          } as FlowEdge,
          eds,
        ) as FlowEdge[],
      );
    },
    [nodes],
  );

  const equipBySlot = useMemo(() => {
    const m = new Map<number, EquipRow>();
    for (const e of equips) if (e.slotIndex !== null) m.set(e.slotIndex, e);
    return m;
  }, [equips]);

  function addSkillNode() {
    const id = nextNodeId(nodes, "n");
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "skillNode",
        position: { x: 80 + nds.length * 60, y: 80 + nds.length * 40 },
        data: { type: "skill", nodeId: id, equipSlot: 0, inputFrom: "agent.input" },
      },
    ]);
    setSelectedId(id);
  }

  function addBranchNode() {
    const id = nextNodeId(nodes, "br");
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "branchNode",
        position: { x: 80 + nds.length * 60, y: 80 + nds.length * 40 },
        data: {
          type: "branch",
          nodeId: id,
          inputFrom: "agent.input",
          cases: [{ path: "kind", op: "eq", value: "2D", label: "twoD" }],
          defaultLabel: undefined,
        },
      },
    ]);
    setSelectedId(id);
  }

  function addLoopNode() {
    const id = nextNodeId(nodes, "loop");
    const firstSlot = equipBySlot.keys().next().value ?? 0;
    const seedBodyId = "step1";
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "loopNode",
        position: { x: 80 + nds.length * 60, y: 80 + nds.length * 40 },
        data: {
          type: "loop",
          nodeId: id,
          inputFrom: "agent.input",
          maxIterations: 3,
          aggregate: "last",
          exitWhen: [],
          body: {
            nodes: [{ type: "skill", nodeId: seedBodyId, equipSlot: firstSlot, inputFrom: "agent.input" }],
            edges: [],
            positions: { [seedBodyId]: { x: 100, y: 100 } },
          },
        },
      },
    ]);
    setSelectedId(id);
  }

  function addForEachNode() {
    const id = nextNodeId(nodes, "fe");
    const firstSlot = equipBySlot.keys().next().value ?? 0;
    // Body reads agent.input.item — seed a skill so admin can dry-run.
    const seedBodyId = "process";
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "forEachNode",
        position: { x: 80 + nds.length * 60, y: 80 + nds.length * 40 },
        data: {
          type: "forEach",
          nodeId: id,
          inputFrom: "agent.input",
          maxItems: 10,
          aggregate: "concat-array",
          body: {
            nodes: [{ type: "skill", nodeId: seedBodyId, equipSlot: firstSlot, inputFrom: "agent.input" }],
            edges: [],
            positions: { [seedBodyId]: { x: 100, y: 100 } },
          },
        },
      },
    ]);
    setSelectedId(id);
  }

  function addTransformNode() {
    const id = nextNodeId(nodes, "tx");
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "transformNode",
        position: { x: 80 + nds.length * 60, y: 80 + nds.length * 40 },
        data: { type: "transform", nodeId: id, inputFrom: "agent.input", expression: "$" },
      },
    ]);
    setSelectedId(id);
  }

  function deleteSelected() {
    if (selectedEdgeId) {
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      return;
    }
    if (!selectedId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }

  function patchNode(id: string, patch: Partial<NodeData>) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } as NodeData } : n,
      ),
    );
  }

  function patchEdge(id: string, when: string | undefined) {
    setEdges((eds) =>
      eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, when }, label: when } : e)),
    );
  }

  async function onSave() {
    setBusy(true);
    setTopErr(null);
    try {
      const r = await fetch(`/api/agents/${agent.id}/pipeline`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nodes.length === 0 ? null : buildConfig(nodes, edges) }),
      });
      setBusy(false);
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setTopErr(typeof j.error === "string" ? j.error : "save failed");
        return;
      }
      router.refresh();
      onClose();
    } catch (e) {
      setBusy(false);
      setTopErr(e instanceof Error ? e.message : "save failed");
    }
  }

  async function onTestRun() {
    setTest({ kind: "running" });
    let parsedInput: unknown = null;
    if (sampleInput.trim()) {
      try {
        parsedInput = JSON.parse(sampleInput);
      } catch (e) {
        setTest({
          kind: "err",
          errorCode: "INVALID_INPUT_JSON",
          errorMessage: e instanceof Error ? e.message : "invalid sample input JSON",
          runLog: [],
        });
        return;
      }
    }
    try {
      const r = await fetch(`/api/agents/${agent.id}/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: parsedInput,
          pipelineConfig: nodes.length === 0 ? null : buildConfig(nodes, edges),
        }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        output?: unknown;
        runLog?: RunLog;
        errorCode?: string;
        errorMessage?: string;
        durationMs?: number;
      };
      if (!r.ok) {
        setTest({
          kind: "err",
          errorCode: `HTTP_${r.status}`,
          errorMessage: typeof data.error === "string" ? data.error : "request failed",
          runLog: [],
        });
        return;
      }
      if (data.ok) {
        setTest({
          kind: "ok",
          output: data.output,
          runLog: data.runLog ?? [],
          durationMs: data.durationMs ?? 0,
        });
      } else {
        setTest({
          kind: "err",
          errorCode: data.errorCode ?? "UNKNOWN",
          errorMessage: data.errorMessage ?? "test run failed",
          runLog: data.runLog ?? [],
        });
      }
    } catch (e) {
      setTest({
        kind: "err",
        errorCode: "FETCH_THREW",
        errorMessage: e instanceof Error ? e.message : "fetch threw",
        runLog: [],
      });
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  // The selected sub-canvas target — either a loop or forEach node. The
  // sub-canvas modal opens for both; kind drives header copy + accent color.
  const editingBodyNode =
    bodyEditorFor !== null
      ? (nodes.find(
          (n) =>
            n.id === bodyEditorFor && (n.data.type === "loop" || n.data.type === "forEach"),
        ) ?? null)
      : null;
  const portal = typeof document !== "undefined" ? document.body : null;
  if (!portal) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="border-b border-secondary/40 bg-surface-container/90 px-4 py-3 flex items-center justify-between gap-4">
        <div>
          <div className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
            Backbone DAG · {agent.codename}
          </div>
          <div className="text-[12px] text-on-surface-variant">
            {nodes.length} nodes · {edges.length} edges
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="px-4 py-1.5 bg-secondary text-background font-label text-[10px] tracking-[0.25em] uppercase disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            ref={closeBtnRef}
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 border border-on-surface-variant/40 text-on-surface-variant font-label text-[10px] tracking-[0.25em] uppercase hover:text-on-surface"
          >
            Close
          </button>
        </div>
      </div>

      {topErr ? (
        <div className="px-4 py-2 bg-error/15 text-error text-[12px]">{topErr}</div>
      ) : null}

      {/* Body: canvas + sidebar */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          <div className="absolute top-2 left-2 z-10 flex gap-2">
            <button
              type="button"
              onClick={addSkillNode}
              className="px-3 py-1.5 bg-secondary/[0.15] border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase"
            >
              + Skill
            </button>
            <button
              type="button"
              onClick={addBranchNode}
              className="px-3 py-1.5 bg-tertiary/[0.15] border border-tertiary/60 text-tertiary font-label text-[10px] tracking-[0.25em] uppercase"
            >
              + Branch
            </button>
            <button
              type="button"
              onClick={addLoopNode}
              className="px-3 py-1.5 border-2 border-double font-label text-[10px] tracking-[0.25em] uppercase"
              style={{ borderColor: "rgb(196 181 253 / 0.6)", color: "rgb(196 181 253)", background: "rgb(196 181 253 / 0.12)" }}
            >
              + Loop
            </button>
            <button
              type="button"
              onClick={addForEachNode}
              className="px-3 py-1.5 border-2 font-label text-[10px] tracking-[0.25em] uppercase"
              style={{ borderColor: "rgb(56 189 248 / 0.6)", color: "rgb(56 189 248)", background: "rgb(56 189 248 / 0.12)" }}
            >
              + ForEach
            </button>
            <button
              type="button"
              onClick={addTransformNode}
              className="px-3 py-1.5 border-2 font-label text-[10px] tracking-[0.25em] uppercase"
              style={{ borderColor: "rgb(52 211 153 / 0.6)", color: "rgb(52 211 153)", background: "rgb(52 211 153 / 0.12)" }}
            >
              + Transform
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={!selectedId && !selectedEdgeId}
              className="px-3 py-1.5 border border-error/60 text-error font-label text-[10px] tracking-[0.25em] uppercase disabled:opacity-40"
            >
              Delete
            </button>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSelectedId(n.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, e) => {
              setSelectedEdgeId(e.id);
              setSelectedId(null);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setSelectedEdgeId(null);
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="rgba(144,222,205,0.12)" />
            <Controls className="!bg-surface-container !border-secondary/40" />
            <MiniMap
              className="!bg-surface-container !border-secondary/40"
              nodeColor={(n) => (n.type === "branchNode" ? "rgba(255,180,140,0.6)" : "rgba(233,193,118,0.6)")}
            />
          </ReactFlow>
        </div>

        {/* Sidebar */}
        <aside className="w-[360px] border-l border-secondary/40 bg-surface-container/95 overflow-y-auto p-4 space-y-4">
          {selectedNode ? (
            <NodePanel
              key={selectedNode.id}
              node={selectedNode}
              allNodes={nodes}
              equipBySlot={equipBySlot}
              onPatch={(patch) => patchNode(selectedNode.id, patch)}
              onRename={(newId) => {
                if (!newId || newId === selectedNode.id) return;
                if (nodes.some((n) => n.id === newId)) return; // collision
                if (!/^[a-zA-Z0-9_-]+$/.test(newId)) return;
                const oldId = selectedNode.id;
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === oldId ? { ...n, id: newId, data: { ...n.data, nodeId: newId } } : n,
                  ),
                );
                setEdges((eds) =>
                  eds.map((e) => ({
                    ...e,
                    source: e.source === oldId ? newId : e.source,
                    target: e.target === oldId ? newId : e.target,
                  })),
                );
                setSelectedId(newId);
              }}
              onOpenLoopBody={(nodeId) => setBodyEditorFor(nodeId)}
            />
          ) : selectedEdge ? (
            <EdgePanel
              edge={selectedEdge}
              sourceNode={nodes.find((n) => n.id === selectedEdge.source) ?? null}
              onChangeWhen={(when) => patchEdge(selectedEdge.id, when)}
            />
          ) : (
            <div className="text-[12px] text-on-surface-variant">
              Click a node or edge to edit. Drag from a node&apos;s right handle to its target&apos;s
              left handle to connect.
            </div>
          )}

          <div className="pt-4 border-t border-secondary/30 space-y-2">
            <div className="font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant">
              Test Run (Sample Input · JSON)
            </div>
            <textarea
              value={sampleInput}
              onChange={(e) => setSampleInput(e.target.value)}
              rows={4}
              className="w-full bg-background/60 border border-secondary/30 px-2 py-1 text-[11px] font-mono text-on-surface focus:outline-none focus:border-secondary resize-y"
            />
            <button
              type="button"
              onClick={onTestRun}
              disabled={test.kind === "running"}
              className="w-full px-3 py-1.5 border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10 disabled:opacity-40"
            >
              {test.kind === "running" ? "Running…" : "▷ Test Run"}
            </button>
            {test.kind === "ok" ? (
              <div className="text-[11px] text-primary border border-primary/30 p-2 max-h-48 overflow-y-auto">
                <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1">
                  ✓ {test.durationMs}ms · output
                </div>
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(test.output, null, 2)}
                </pre>
              </div>
            ) : test.kind === "err" ? (
              <div className="text-[11px] text-error border border-error/30 p-2 max-h-48 overflow-y-auto">
                <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1">
                  ✕ {test.errorCode}
                </div>
                <div className="break-words">{test.errorMessage}</div>
              </div>
            ) : null}
            {test.kind === "ok" || test.kind === "err" ? (
              <RunLogTrace runLog={test.runLog} />
            ) : null}
          </div>
        </aside>
      </div>
      {editingBodyNode &&
      (editingBodyNode.data.type === "loop" || editingBodyNode.data.type === "forEach") ? (
        <BodySubCanvasEditor
          parentNodeId={editingBodyNode.id}
          kind={editingBodyNode.data.type}
          initialBody={editingBodyNode.data.body}
          equipBySlot={equipBySlot}
          onCommit={(body) => {
            const targetId = editingBodyNode.id;
            setNodes((nds) =>
              nds.map((n) => {
                if (n.id !== targetId) return n;
                if (n.data.type === "loop") return { ...n, data: { ...n.data, body } };
                if (n.data.type === "forEach") return { ...n, data: { ...n.data, body } };
                return n;
              }),
            );
            setBodyEditorFor(null);
          }}
          onCancel={() => setBodyEditorFor(null)}
        />
      ) : null}
    </div>,
    portal,
  );
}

// — — Node property panel — — — — — — — — — — — — — — — — — — — — — — —

function NodePanel({
  node,
  allNodes,
  equipBySlot,
  onPatch,
  onRename,
  onOpenLoopBody,
}: {
  node: FlowNode;
  allNodes: FlowNode[];
  equipBySlot: Map<number, EquipRow>;
  onPatch: (patch: Partial<NodeData>) => void;
  onRename: (newId: string) => void;
  // null => disable the "Edit loop body" button (used inside the body
  // editor itself, where loop nodes can't appear anyway — defensive).
  onOpenLoopBody: ((nodeId: string) => void) | null;
}) {
  const otherNodeIds = allNodes.map((n) => n.id).filter((id) => id !== node.id);
  const sourceOptions = ["agent.input", ...otherNodeIds.map((id) => `${id}.output`)];

  return (
    <div className="space-y-3">
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary mb-1">
          Node ID
        </div>
        <input
          defaultValue={node.id}
          onBlur={(e) => onRename(e.target.value.trim())}
          className="w-full bg-background/60 border border-secondary/30 px-2 py-1 text-[12px] text-on-surface"
        />
      </div>

      {node.data.type === "skill" ? (
        <SkillNodePanel
          data={node.data}
          equipBySlot={equipBySlot}
          sourceOptions={sourceOptions}
          onPatch={onPatch}
        />
      ) : node.data.type === "branch" ? (
        <BranchNodePanel
          data={node.data}
          sourceOptions={sourceOptions}
          onPatch={onPatch}
        />
      ) : node.data.type === "loop" ? (
        <LoopNodePanel
          data={node.data}
          sourceOptions={sourceOptions}
          onPatch={onPatch}
          onOpenBody={onOpenLoopBody ? () => onOpenLoopBody(node.id) : null}
        />
      ) : node.data.type === "forEach" ? (
        <ForEachNodePanel
          data={node.data}
          sourceOptions={sourceOptions}
          onPatch={onPatch}
          onOpenBody={onOpenLoopBody ? () => onOpenLoopBody(node.id) : null}
        />
      ) : (
        <TransformNodePanel
          data={node.data}
          sourceOptions={sourceOptions}
          onPatch={onPatch}
        />
      )}
    </div>
  );
}

function SkillNodePanel({
  data,
  equipBySlot,
  sourceOptions,
  onPatch,
}: {
  data: SkillNodeData;
  equipBySlot: Map<number, EquipRow>;
  sourceOptions: string[];
  onPatch: (patch: Partial<SkillNodeData>) => void;
}) {
  return (
    <>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary mb-1">
          Equip Slot
        </div>
        <select
          value={data.equipSlot}
          onChange={(e) => onPatch({ equipSlot: Number(e.target.value) })}
          className="w-full bg-background/60 border border-secondary/30 px-2 py-1 text-[12px] text-on-surface"
        >
          {Array.from({ length: SLOT_COUNT }).map((_, i) => {
            const eq = equipBySlot.get(i);
            return (
              <option key={i} value={i}>
                Slot {i} · {eq ? eq.skill.nameEn : "(empty)"}
              </option>
            );
          })}
        </select>
      </div>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
    </>
  );
}

function BranchNodePanel({
  data,
  sourceOptions,
  onPatch,
}: {
  data: BranchNodeData;
  sourceOptions: string[];
  onPatch: (patch: Partial<BranchNodeData>) => void;
}) {
  function patchCase(idx: number, patch: Partial<BranchCase>) {
    const next = data.cases.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onPatch({ cases: next });
  }
  function addCase() {
    onPatch({ cases: [...data.cases, { path: "", op: "eq", value: "", label: `case${data.cases.length + 1}` }] });
  }
  function removeCase(idx: number) {
    onPatch({ cases: data.cases.filter((_, i) => i !== idx) });
  }

  return (
    <>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-tertiary mb-1">
          Cases
        </div>
        <div className="space-y-2">
          {data.cases.map((c, i) => (
            <div key={i} className="border border-tertiary/40 rounded p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  placeholder="path (e.g. kind)"
                  value={c.path}
                  onChange={(e) => patchCase(i, { path: e.target.value })}
                  className="flex-1 min-w-0 bg-background/60 border border-tertiary/30 px-1.5 py-0.5 text-[11px] text-on-surface"
                />
                <select
                  value={c.op}
                  onChange={(e) => patchCase(i, { op: e.target.value as BranchCase["op"] })}
                  className="bg-background/60 border border-tertiary/30 px-1 py-0.5 text-[11px] text-on-surface"
                >
                  <option value="eq">eq</option>
                  <option value="ne">ne</option>
                  <option value="in">in</option>
                  <option value="exists">exists</option>
                </select>
              </div>
              {c.op !== "exists" ? (
                <input
                  placeholder={c.op === "in" ? '["a","b"]' : '"value"'}
                  value={typeof c.value === "string" ? c.value : JSON.stringify(c.value ?? "")}
                  onChange={(e) => {
                    let v: unknown = e.target.value;
                    if (c.op === "in") {
                      try { v = JSON.parse(e.target.value); } catch { /* leave as string */ }
                    } else {
                      try { v = JSON.parse(e.target.value); } catch { /* leave as string */ }
                    }
                    patchCase(i, { value: v });
                  }}
                  className="w-full bg-background/60 border border-tertiary/30 px-1.5 py-0.5 text-[11px] font-mono text-on-surface"
                />
              ) : null}
              <div className="flex gap-1.5 items-center">
                <input
                  placeholder="label (matches edge.when)"
                  value={c.label}
                  onChange={(e) => patchCase(i, { label: e.target.value })}
                  className="flex-1 min-w-0 bg-background/60 border border-tertiary/30 px-1.5 py-0.5 text-[11px] text-on-surface"
                />
                <button
                  type="button"
                  onClick={() => removeCase(i)}
                  className="text-error/80 hover:text-error text-[10px]"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addCase}
            className="w-full px-2 py-1 border border-tertiary/40 text-tertiary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-tertiary/10"
          >
            + Case
          </button>
        </div>
      </div>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-tertiary mb-1">
          Default Label (optional)
        </div>
        <input
          placeholder="(none — abort if no case matches)"
          value={data.defaultLabel ?? ""}
          onChange={(e) => onPatch({ defaultLabel: e.target.value || undefined })}
          className="w-full bg-background/60 border border-tertiary/30 px-2 py-1 text-[11px] text-on-surface"
        />
      </div>
    </>
  );
}

function LoopNodePanel({
  data,
  sourceOptions,
  onPatch,
  onOpenBody,
}: {
  data: LoopNodeData;
  sourceOptions: string[];
  onPatch: (patch: Partial<LoopNodeData>) => void;
  onOpenBody: (() => void) | null;
}) {
  function patchExitWhen(idx: number, patch: Partial<BranchCase>) {
    const next = data.exitWhen.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onPatch({ exitWhen: next });
  }
  function addExitCase() {
    onPatch({
      exitWhen: [
        ...data.exitWhen,
        { path: "", op: "exists", value: undefined, label: `exit${data.exitWhen.length + 1}` },
      ],
    });
  }
  function removeExitCase(idx: number) {
    onPatch({ exitWhen: data.exitWhen.filter((_, i) => i !== idx) });
  }
  return (
    <>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(196 181 253)" }}>
            Max Iter
          </div>
          <input
            type="number"
            min={1}
            max={10}
            value={data.maxIterations}
            onChange={(e) => {
              const n = Math.max(1, Math.min(10, Number(e.target.value) || 1));
              onPatch({ maxIterations: n });
            }}
            className="w-full bg-background/60 border border-violet-300/30 px-2 py-1 text-[12px] text-on-surface"
          />
        </div>
        <div>
          <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(196 181 253)" }}>
            Aggregate
          </div>
          <select
            value={data.aggregate}
            onChange={(e) => onPatch({ aggregate: e.target.value as LoopNodeData["aggregate"] })}
            className="w-full bg-background/60 border border-violet-300/30 px-2 py-1 text-[12px] text-on-surface"
          >
            <option value="last">last</option>
            <option value="concat-array">concat-array</option>
          </select>
        </div>
      </div>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(196 181 253)" }}>
          Exit When (optional — match against iteration leaf output)
        </div>
        <div className="space-y-2">
          {data.exitWhen.map((c, i) => (
            <div key={i} className="border border-violet-300/40 rounded p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  placeholder="path (e.g. status)"
                  value={c.path}
                  onChange={(e) => patchExitWhen(i, { path: e.target.value })}
                  className="flex-1 min-w-0 bg-background/60 border border-violet-300/30 px-1.5 py-0.5 text-[11px] text-on-surface"
                />
                <select
                  value={c.op}
                  onChange={(e) => patchExitWhen(i, { op: e.target.value as BranchCase["op"] })}
                  className="bg-background/60 border border-violet-300/30 px-1 py-0.5 text-[11px] text-on-surface"
                >
                  <option value="eq">eq</option>
                  <option value="ne">ne</option>
                  <option value="in">in</option>
                  <option value="exists">exists</option>
                </select>
              </div>
              {c.op !== "exists" ? (
                <input
                  placeholder={c.op === "in" ? '["a","b"]' : '"value"'}
                  value={typeof c.value === "string" ? c.value : JSON.stringify(c.value ?? "")}
                  onChange={(e) => {
                    let v: unknown = e.target.value;
                    try { v = JSON.parse(e.target.value); } catch { /* keep string */ }
                    patchExitWhen(i, { value: v });
                  }}
                  className="w-full bg-background/60 border border-violet-300/30 px-1.5 py-0.5 text-[11px] font-mono text-on-surface"
                />
              ) : null}
              <div className="flex gap-1.5 items-center">
                <input
                  placeholder="label (cosmetic — for trace)"
                  value={c.label}
                  onChange={(e) => patchExitWhen(i, { label: e.target.value })}
                  className="flex-1 min-w-0 bg-background/60 border border-violet-300/30 px-1.5 py-0.5 text-[11px] text-on-surface"
                />
                <button
                  type="button"
                  onClick={() => removeExitCase(i)}
                  className="text-error/80 hover:text-error text-[10px]"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addExitCase}
            className="w-full px-2 py-1 border border-violet-300/40 font-label text-[10px] tracking-[0.25em] uppercase hover:bg-violet-300/10"
            style={{ color: "rgb(196 181 253)" }}
          >
            + Exit Case
          </button>
        </div>
      </div>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(196 181 253)" }}>
          Body ({data.body.nodes.length} nodes / {data.body.edges.length} edges)
        </div>
        <button
          type="button"
          onClick={onOpenBody ?? undefined}
          disabled={!onOpenBody}
          className="w-full px-3 py-2 font-label text-[10px] tracking-[0.25em] uppercase border-2 border-double disabled:opacity-40"
          style={{ borderColor: "rgb(196 181 253 / 0.6)", color: "rgb(196 181 253)" }}
        >
          ▷ Edit Loop Body
        </button>
        <div className="text-[10px] text-on-surface-variant mt-1.5 leading-relaxed">
          Body is a self-contained sub-DAG. Inside, <code>agent.input</code> resolves to the current
          iteration state (loop input on first pass, prior leaf output on subsequent passes).
          Nesting loops further requires the Advanced raw-JSON editor.
        </div>
      </div>
    </>
  );
}

function ForEachNodePanel({
  data,
  sourceOptions,
  onPatch,
  onOpenBody,
}: {
  data: ForEachNodeData;
  sourceOptions: string[];
  onPatch: (patch: Partial<ForEachNodeData>) => void;
  onOpenBody: (() => void) | null;
}) {
  return (
    <>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(56 189 248)" }}>
            Max Items
          </div>
          <input
            type="number"
            min={1}
            max={50}
            value={data.maxItems}
            onChange={(e) => {
              const n = Math.max(1, Math.min(50, Number(e.target.value) || 1));
              onPatch({ maxItems: n });
            }}
            className="w-full bg-background/60 border border-sky-400/30 px-2 py-1 text-[12px] text-on-surface"
          />
        </div>
        <div>
          <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(56 189 248)" }}>
            Aggregate
          </div>
          <select
            value={data.aggregate}
            onChange={(e) => onPatch({ aggregate: e.target.value as ForEachNodeData["aggregate"] })}
            className="w-full bg-background/60 border border-sky-400/30 px-2 py-1 text-[12px] text-on-surface"
          >
            <option value="concat-array">concat-array</option>
            <option value="last">last</option>
          </select>
        </div>
      </div>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(56 189 248)" }}>
          Body ({data.body.nodes.length} nodes / {data.body.edges.length} edges)
        </div>
        <button
          type="button"
          onClick={onOpenBody ?? undefined}
          disabled={!onOpenBody}
          className="w-full px-3 py-2 font-label text-[10px] tracking-[0.25em] uppercase border-2 disabled:opacity-40"
          style={{ borderColor: "rgb(56 189 248 / 0.6)", color: "rgb(56 189 248)" }}
        >
          ▷ Edit forEach Body
        </button>
        <div className="text-[10px] text-on-surface-variant mt-1.5 leading-relaxed">
          Body runs once per item. Inside, <code>agent.input</code> ={" "}
          <code>{`{ item, index, total }`}</code> — read{" "}
          <code>agent.input.item</code> to get the current array element. Aggregate{" "}
          <code>concat-array</code> collects all leaf outputs into one array; <code>last</code> returns
          only the final iteration&apos;s output.
        </div>
      </div>
    </>
  );
}

function TransformNodePanel({
  data,
  sourceOptions,
  onPatch,
}: {
  data: TransformNodeData;
  sourceOptions: string[];
  onPatch: (patch: Partial<TransformNodeData>) => void;
}) {
  return (
    <>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(52 211 153)" }}>
          JSONata Expression
        </div>
        <textarea
          value={data.expression}
          onChange={(e) => onPatch({ expression: e.target.value })}
          rows={6}
          spellCheck={false}
          placeholder={"$    /* identity */\n\n/* zip + apply verdict */\n$map(verdicts, function($v, $i) {\n  candidates[$i] ~> $merge({ score: score + ($v.match ? 50 : -30) })\n})"}
          className="w-full bg-background/60 border border-emerald-400/30 px-2 py-1 text-[11px] font-mono text-on-surface focus:outline-none focus:border-emerald-400 resize-y"
        />
        <div className="text-[10px] text-on-surface-variant mt-1.5 leading-relaxed">
          Pure JSON-in JSON-out — no FS, no network, no side effects. Use for
          zip / map / filter / reduce on arrays + objects without writing a
          dedicated handler. <code>$</code> = whole input.{" "}
          <a
            href="https://docs.jsonata.org/overview"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-on-surface"
          >
            JSONata reference
          </a>
        </div>
      </div>
    </>
  );
}

function InputFromEditor({
  value,
  sourceOptions,
  onChange,
}: {
  value: SourceRef;
  sourceOptions: string[];
  onChange: (v: SourceRef) => void;
}) {
  const isMerge = typeof value !== "string";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary">
          Input From
        </div>
        <button
          type="button"
          onClick={() => onChange(isMerge ? "agent.input" : { merge: { input: "agent.input" } })}
          className="text-[10px] text-on-surface-variant hover:text-on-surface underline"
        >
          {isMerge ? "→ single" : "→ merge"}
        </button>
      </div>
      {!isMerge ? (
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-background/60 border border-secondary/30 px-2 py-1 text-[11px] text-on-surface"
        >
          {sourceOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-1.5">
          {Object.entries((value as { merge: Record<string, string> }).merge).map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <input
                value={k}
                onChange={(e) => {
                  const merge = { ...(value as { merge: Record<string, string> }).merge };
                  delete merge[k];
                  merge[e.target.value] = v;
                  onChange({ merge });
                }}
                className="w-24 bg-background/60 border border-secondary/30 px-1.5 py-0.5 text-[11px] text-on-surface"
              />
              <select
                value={v}
                onChange={(e) => {
                  const merge = { ...(value as { merge: Record<string, string> }).merge };
                  merge[k] = e.target.value;
                  onChange({ merge });
                }}
                className="flex-1 bg-background/60 border border-secondary/30 px-1.5 py-0.5 text-[11px] text-on-surface"
              >
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const merge = { ...(value as { merge: Record<string, string> }).merge };
                  delete merge[k];
                  onChange({ merge });
                }}
                className="text-error/80 hover:text-error text-[10px] px-1"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const merge = { ...(value as { merge: Record<string, string> }).merge };
              let i = 1;
              while (`key${i}` in merge) i++;
              merge[`key${i}`] = sourceOptions[0] ?? "agent.input";
              onChange({ merge });
            }}
            className="w-full px-2 py-1 border border-secondary/40 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10"
          >
            + Source
          </button>
        </div>
      )}
    </div>
  );
}

function EdgePanel({
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

// — — Run log trace — — — — — — — — — — — — — — — — — — — — — — — — —

function RunLogTrace({ runLog }: { runLog: RunLog }) {
  if (!runLog.length) return null;
  return (
    <details className="text-[11px] border border-on-surface-variant/30 rounded">
      <summary className="cursor-pointer font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant px-2 py-1">
        Trace ({runLog.length} entries)
      </summary>
      <div className="px-2 py-1 space-y-1 max-h-48 overflow-y-auto">
        {runLog.map((r, i) => (
          <div
            key={i}
            className={[
              "flex items-center justify-between gap-2 border-l-2 pl-2 py-0.5",
              r.skipped
                ? "border-on-surface-variant/30 text-on-surface-variant/60"
                : r.ok
                  ? "border-primary/60"
                  : "border-error/60 text-error",
            ].join(" ")}
          >
            <span className="truncate">
              {r.skipped ? "○" : r.ok ? "✓" : "✕"} {r.stepId}
              {r.branchLabel ? ` → ${r.branchLabel}` : ""}
            </span>
            <span className="shrink-0 text-on-surface-variant/60">
              {r.skipped ? "skipped" : `${r.durationMs}ms`}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
