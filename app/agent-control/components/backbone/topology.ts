// Layout / topology helpers — autoLayout, nextNodeId, I/O node construction,
// scene-aware reachability for BEGIN/END decorative edges.

import type { BoundSceneSummary } from "../../types";
import type { EdgeData, FlowEdge, FlowNode, NodeData } from "./types";

// Approximate node footprint for bounding box math. Real width is
// determined by content; these are upper bounds for layout padding.
export const USER_NODE_W = 200;
export const USER_NODE_H = 80;

export function autoLayout(
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

export function nextNodeId(existing: FlowNode[], prefix: string): string {
  const used = new Set(existing.map((n) => n.id));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

// Build the decorative I/O nodes:
//   - 1 AGENT-BOUNDARY rectangle wrapping all user nodes
//   - N BEGIN nodes (one per bound scene) on the far left
//   - 1 AGENT.INPUT convergence node just inside the left boundary
//   - 1 AGENT.OUTPUT convergence node just inside the right boundary
//   - N END nodes on the far right
//
// All decorative — admin can drag, but positions are NEVER persisted
// (filtered out of buildConfig).
//
// 2026-05-12 — visual model swapped from "N×M tangled edges" to
// "BEGINs ─→ AGENT.INPUT ─→ DAG ─→ AGENT.OUTPUT ─→ ENDs" so the picture
// matches runtime semantics (one invocation = one input + one output;
// BEGIN/END multiplicity = alternative scene candidates, not concurrent
// data flow).
export const AGENT_INPUT_NODE_ID = "__agent_input__";
export const AGENT_OUTPUT_NODE_ID = "__agent_output__";

export function buildIoNodes(
  boundScenes: BoundSceneSummary[],
  userNodes: FlowNode[],
  agentCodename: string,
): FlowNode[] {
  // Position BEGIN column to the left of the leftmost user node, END
  // column to the right of the rightmost. Fallback bounds keep the layout
  // sane when there are 0 user nodes yet.
  let minX = -200;
  let maxX = 800;
  let minY = 0;
  let maxY = 400;
  if (userNodes.length > 0) {
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    maxY = -Infinity;
    for (const n of userNodes) {
      if (n.position.x < minX) minX = n.position.x;
      if (n.position.x > maxX) maxX = n.position.x;
      if (n.position.y < minY) minY = n.position.y;
      if (n.position.y > maxY) maxY = n.position.y;
    }
  }
  // BEGIN/END columns pushed further out to leave room for the new
  // convergence nodes between them and the user-DAG. AGENT.INPUT sits
  // just inside the left boundary edge; AGENT.OUTPUT mirrors on the right.
  const beginX = minX - 540;
  const endX = maxX + USER_NODE_W + 360;
  const agentInputX = minX - 200;
  const agentOutputX = maxX + USER_NODE_W + 80;
  const midY = userNodes.length > 0 ? (minY + maxY) / 2 : 200;
  const STACK_GAP = 220;
  const out: FlowNode[] = [];

  // 1. Agent boundary FIRST so it renders behind everything else
  // (react-flow paints in array order; first = bottom z-layer). Pad ~36px
  // on each side so user nodes sit comfortably inside the box, with
  // headroom for the "AGENT · X" label that floats above the top edge.
  if (userNodes.length > 0) {
    const PAD_X = 36;
    const PAD_TOP = 36;
    const PAD_BOTTOM = 36;
    out.push({
      id: "__agent_boundary__",
      type: "agentBoundaryNode",
      position: { x: minX - PAD_X, y: minY - PAD_TOP },
      // ReactFlow respects style.width/height for sizing custom nodes.
      style: {
        width: maxX + USER_NODE_W + PAD_X * 2 - minX,
        height: maxY + USER_NODE_H + PAD_TOP + PAD_BOTTOM - minY,
        zIndex: -1,
      },
      draggable: false,
      selectable: false,
      deletable: false,
      data: {
        __ioRole: "agentBoundary",
        codename: agentCodename,
      } as unknown as NodeData,
    });
  }

  if (boundScenes.length === 0) return out;

  // 2. AGENT.INPUT and AGENT.OUTPUT convergence nodes — only meaningful
  // when there are user nodes (otherwise nothing flows through them).
  if (userNodes.length > 0) {
    out.push({
      id: AGENT_INPUT_NODE_ID,
      type: "agentInputNode",
      position: { x: agentInputX, y: midY },
      deletable: false,
      data: { __ioRole: "agentInput" } as unknown as NodeData,
    });
    out.push({
      id: AGENT_OUTPUT_NODE_ID,
      type: "agentOutputNode",
      position: { x: agentOutputX, y: midY },
      deletable: false,
      data: { __ioRole: "agentOutput" } as unknown as NodeData,
    });
  }

  // 3. BEGIN / END nodes (one pair per bound scene). Vertically centered
  // around midY so the BEGIN/END column is balanced relative to the
  // convergence nodes.
  const stackOffset = ((boundScenes.length - 1) * STACK_GAP) / 2;
  boundScenes.forEach((s, i) => {
    const sceneLabel = s.label.zh || s.label.en;
    const y = midY + i * STACK_GAP - stackOffset;
    out.push({
      id: `__begin__${s.sceneKey}`,
      type: "beginNode",
      position: { x: beginX, y },
      deletable: false,
      data: {
        __ioRole: "begin",
        sceneKey: s.sceneKey,
        sceneLabel,
        invocation: s.invocation,
        fields: s.contextFields,
        via: s.via,
      } as unknown as NodeData,
    });
    out.push({
      id: `__end__${s.sceneKey}`,
      type: "endNode",
      position: { x: endX, y },
      deletable: false,
      data: {
        __ioRole: "end",
        sceneKey: s.sceneKey,
        sceneLabel,
        invocation: s.invocation,
        fields: s.outputFields,
        via: s.via,
      } as unknown as NodeData,
    });
  });
  return out;
}

// Build decorative edges that mirror the runtime flow shape:
//   BEGINs → AGENT.INPUT → user-roots → ... → user-leaves → AGENT.OUTPUT → ENDs
//
// Edge styling encodes the "candidate vs actual" distinction:
//   - dashed sky-400  : BEGIN → AGENT.INPUT (candidate scene trigger)
//   - solid  sky-400  : AGENT.INPUT → root  (actual data entering DAG)
//   - solid  pink-400 : leaf → AGENT.OUTPUT (actual data leaving DAG)
//   - dashed pink-400 : AGENT.OUTPUT → END  (candidate schema validation)
export function buildIoEdges(
  boundScenes: BoundSceneSummary[],
  userNodes: FlowNode[],
  userEdges: FlowEdge[],
): FlowEdge[] {
  if (boundScenes.length === 0 || userNodes.length === 0) return [];
  const inDeg = new Map<string, number>(userNodes.map((n) => [n.id, 0]));
  const outDeg = new Map<string, number>(userNodes.map((n) => [n.id, 0]));
  for (const e of userEdges) {
    if (inDeg.has(e.target)) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    if (outDeg.has(e.source)) outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
  }
  const roots = userNodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0);
  const leaves = userNodes.filter((n) => (outDeg.get(n.id) ?? 0) === 0);

  const out: FlowEdge[] = [];
  const SKY = "rgb(96 165 250)";
  const PINK = "rgb(244 114 182)";

  // BEGIN → AGENT.INPUT (one per scene, dashed = candidate)
  for (const s of boundScenes) {
    out.push({
      id: `__ioedge__begin__${s.sceneKey}`,
      source: `__begin__${s.sceneKey}`,
      target: AGENT_INPUT_NODE_ID,
      style: { stroke: SKY, strokeDasharray: "4 4", strokeWidth: 1.5 },
      animated: false,
      deletable: false,
      data: { __ioRole: "begin" } as unknown as EdgeData,
    });
  }

  // AGENT.INPUT → root (solid = actual data flow into DAG)
  for (const r of roots) {
    out.push({
      id: `__ioedge__input__${r.id}`,
      source: AGENT_INPUT_NODE_ID,
      target: r.id,
      style: { stroke: SKY, strokeWidth: 1.75 },
      animated: false,
      deletable: false,
      data: { __ioRole: "begin" } as unknown as EdgeData,
    });
  }

  // leaf → AGENT.OUTPUT (solid = actual data flow out of DAG)
  for (const leaf of leaves) {
    out.push({
      id: `__ioedge__output__${leaf.id}`,
      source: leaf.id,
      target: AGENT_OUTPUT_NODE_ID,
      style: { stroke: PINK, strokeWidth: 1.75 },
      animated: false,
      deletable: false,
      data: { __ioRole: "end" } as unknown as EdgeData,
    });
  }

  // AGENT.OUTPUT → END (one per scene, dashed = candidate)
  for (const s of boundScenes) {
    out.push({
      id: `__ioedge__end__${s.sceneKey}`,
      source: AGENT_OUTPUT_NODE_ID,
      target: `__end__${s.sceneKey}`,
      style: { stroke: PINK, strokeDasharray: "4 4", strokeWidth: 1.5 },
      animated: false,
      deletable: false,
      data: { __ioRole: "end" } as unknown as EdgeData,
    });
  }

  return out;
}
