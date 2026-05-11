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

// Build the decorative BEGIN / END FlowNodes (one pair per bound scene)
// + a single AGENT-BOUNDARY rectangle wrapping all user nodes. All are
// read-only — admin can drag, but positions are NEVER persisted
// (filtered out of buildConfig).
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
  const beginX = minX - 320;
  const endX = maxX + 320;
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
  boundScenes.forEach((s, i) => {
    const sceneLabel = s.label.zh || s.label.en;
    out.push({
      id: `__begin__${s.sceneKey}`,
      type: "beginNode",
      position: { x: beginX, y: i * STACK_GAP },
      deletable: false,
      data: {
        __ioRole: "begin",
        sceneKey: s.sceneKey,
        sceneLabel,
        invocation: s.invocation,
        fields: s.contextFields,
      } as unknown as NodeData,
    });
    out.push({
      id: `__end__${s.sceneKey}`,
      type: "endNode",
      position: { x: endX, y: i * STACK_GAP },
      deletable: false,
      data: {
        __ioRole: "end",
        sceneKey: s.sceneKey,
        sceneLabel,
        invocation: s.invocation,
        fields: s.outputFields,
      } as unknown as NodeData,
    });
  });
  return out;
}

// Walk a dot.path through a JS object. Mirror of backbone.ts pickPath.
function pickPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

// Mirror of backbone.ts evalCase. Returns one of:
//   - "match"        case matched (statically known)
//   - "no-match"     case definitively did NOT match
//   - "unresolvable" path resolves to a template ({{ctx.X}}) — value is
//                    only known at runtime; can't decide statically
function evalCaseStatic(
  inputMap: unknown,
  c: { path: string; op: string; value: unknown },
): "match" | "no-match" | "unresolvable" {
  const v = pickPath(inputMap, c.path);
  if (typeof v === "string" && v.startsWith("{{")) return "unresolvable";
  let matched = false;
  switch (c.op) {
    case "eq":
      matched = v === c.value;
      break;
    case "ne":
      matched = v !== c.value;
      break;
    case "exists":
      matched = v !== undefined && v !== null;
      break;
    case "in":
      matched = Array.isArray(c.value) && c.value.includes(v);
      break;
  }
  return matched ? "match" : "no-match";
}

// Per-scene reachability: BFS from each root, but at branch nodes only
// follow the edge whose `when` matches the case selected by inputMap.
// Returns the set of leaves (reachable nodes with no reachable children)
// for THIS scene specifically.
function findSceneLeaves(
  inputMap: unknown,
  userNodes: FlowNode[],
  userEdges: FlowEdge[],
  roots: FlowNode[],
): Set<string> {
  const nodeById = new Map(userNodes.map((n) => [n.id, n]));
  const outAdj = new Map<string, FlowEdge[]>();
  for (const e of userEdges) {
    if (!outAdj.has(e.source)) outAdj.set(e.source, []);
    outAdj.get(e.source)!.push(e);
  }
  const reachable = new Set<string>();
  const queue: string[] = roots.map((r) => r.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = nodeById.get(id);
    if (!node) continue;
    const outs = outAdj.get(id) ?? [];
    const data = node.data as unknown as {
      type?: string;
      cases?: { path: string; op: string; value: unknown; label: string }[];
      defaultLabel?: string;
    };
    if (data.type === "branch" && Array.isArray(data.cases)) {
      let pickedLabel: string | undefined;
      let anyUnresolvable = false;
      for (const c of data.cases) {
        const verdict = evalCaseStatic(inputMap, c);
        if (verdict === "unresolvable") {
          anyUnresolvable = true;
          break;
        }
        if (verdict === "match") {
          pickedLabel = c.label;
          break;
        }
      }
      if (!anyUnresolvable && !pickedLabel && data.defaultLabel) {
        pickedLabel = data.defaultLabel;
      }
      if (anyUnresolvable || !pickedLabel) {
        for (const e of outs) queue.push(e.target);
      } else {
        for (const e of outs) {
          if (e.data?.when === pickedLabel) queue.push(e.target);
        }
      }
    } else {
      for (const e of outs) queue.push(e.target);
    }
  }
  const leaves = new Set<string>();
  for (const id of reachable) {
    const outs = outAdj.get(id) ?? [];
    const hasReachableChild = outs.some((e) => reachable.has(e.target));
    if (!hasReachableChild) leaves.add(id);
  }
  return leaves;
}

// Build decorative edges connecting BEGIN nodes to user roots and user
// leaves to END nodes. Scene-aware: each scene's BEGIN/END only connect
// to nodes reachable from THIS scene's static inputMap.
// Read-only, filtered from buildConfig.
export function buildIoEdges(
  boundScenes: BoundSceneSummary[],
  userNodes: FlowNode[],
  userEdges: FlowEdge[],
): FlowEdge[] {
  if (boundScenes.length === 0 || userNodes.length === 0) return [];
  const inDeg = new Map<string, number>(userNodes.map((n) => [n.id, 0]));
  for (const e of userEdges) {
    if (inDeg.has(e.target)) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  const roots = userNodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0);
  const out: FlowEdge[] = [];
  for (const s of boundScenes) {
    const beginId = `__begin__${s.sceneKey}`;
    const endId = `__end__${s.sceneKey}`;
    const sceneLeaves = findSceneLeaves(s.inputMap, userNodes, userEdges, roots);
    for (const r of roots) {
      out.push({
        id: `__ioedge__begin__${s.sceneKey}__${r.id}`,
        source: beginId,
        target: r.id,
        style: { stroke: "rgb(96 165 250)", strokeDasharray: "4 4", strokeWidth: 1.5 },
        animated: false,
        deletable: false,
        data: { __ioRole: "begin" } as unknown as EdgeData,
      });
    }
    for (const leafId of sceneLeaves) {
      out.push({
        id: `__ioedge__end__${s.sceneKey}__${leafId}`,
        source: leafId,
        target: endId,
        style: { stroke: "rgb(244 114 182)", strokeDasharray: "4 4", strokeWidth: 1.5 },
        animated: false,
        deletable: false,
        data: { __ioRole: "end" } as unknown as EdgeData,
      });
    }
  }
  return out;
}
