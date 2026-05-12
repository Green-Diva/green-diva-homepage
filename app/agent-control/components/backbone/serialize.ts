// Persisted config ⇄ react-flow nodes/edges conversion.

import type {
  BodyEdge,
  BodyNodeData,
  BranchCase,
  FlowEdge,
  FlowNode,
  ForEachNodeData,
  LoopNodeData,
  NodeData,
  SourceRef,
} from "./types";
import { autoLayout } from "./topology";

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseInputFrom(raw: unknown): SourceRef | null {
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

export function parseDep(fromStr: string): string | null {
  if (fromStr === "agent.input") return null;
  const m = fromStr.match(/^([a-zA-Z0-9_-]+)\.output$/);
  return m ? m[1] : null;
}

export function parseCases(raw: unknown): BranchCase[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map((c) => ({
    path: typeof c.path === "string" ? c.path : "",
    op: typeof c.op === "string" ? (c.op as BranchCase["op"]) : "eq",
    value: c.value,
    label: typeof c.label === "string" ? c.label : "match",
  }));
}

export function parseBody(raw: unknown): LoopNodeData["body"] {
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
          slotIndex: typeof n.slotIndex === "number" ? n.slotIndex : 0,
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
      } else if (n.type === "persist") {
        nodes.push({ type: "persist", nodeId: id, inputFrom });
      }
      // loop / forEach inside body silently dropped — UI can't render
      // nested sub-canvases (runtime supports MAX_LOOP_DEPTH=2 via raw JSON).
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

export function loadConfig(cfg: unknown): {
  nodes: FlowNode[];
  edges: FlowEdge[];
  warning: string | null;
} {
  if (cfg == null) return { nodes: [], edges: [], warning: null };
  if (!isObject(cfg)) {
    return { nodes: [], edges: [], warning: "Existing config has unknown shape — saving here will replace it." };
  }
  const c = cfg as Record<string, unknown>;
  let v2: {
    nodes: NodeData[];
    edges: Array<{ from: string; to: string; when?: string }>;
    positions: Map<string, { x: number; y: number }>;
  } | null = null;

  if (c.version === 2 && Array.isArray(c.nodes) && Array.isArray(c.edges)) {
    const nodeData: NodeData[] = [];
    const positions = new Map<string, { x: number; y: number }>();
    for (const raw of c.nodes) {
      if (!isObject(raw)) continue;
      const id = typeof raw.id === "string" ? raw.id : null;
      if (!id) continue;
      const inputFrom = parseInputFrom(raw.inputFrom) ?? "agent.input";
      if (raw.type === "skill") {
        const slot = typeof raw.slotIndex === "number" ? raw.slotIndex : 0;
        nodeData.push({ type: "skill", nodeId: id, slotIndex: slot, inputFrom });
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
      } else if (raw.type === "persist") {
        nodeData.push({ type: "persist", nodeId: id, inputFrom });
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
      const slot = typeof raw.slotIndex === "number" ? raw.slotIndex : 0;
      const m = isObject(raw.inputMapping) ? raw.inputMapping : {};
      const fromStr = typeof m.from === "string" ? m.from : "agent.input";
      nodeData.push({ type: "skill", nodeId: id, slotIndex: slot, inputFrom: fromStr });
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
              : nd.type === "transform"
                ? "transformNode"
                : "persistNode",
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

export function serializeBody(body: LoopNodeData["body"]): {
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
          slotIndex: nd.slotIndex,
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
      if (nd.type === "transform") {
        return {
          id: nd.nodeId,
          type: "transform" as const,
          inputFrom: nd.inputFrom,
          expression: nd.expression,
          ...base,
        };
      }
      // persist
      return {
        id: nd.nodeId,
        type: "persist" as const,
        inputFrom: nd.inputFrom,
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

// Decorative BEGIN / END / AGENT-BOUNDARY / AGENT.INPUT / AGENT.OUTPUT
// nodes carry an `__ioRole` sentinel on `data` — ignore them on save so
// they never round-trip into pipelineConfig.
export function isIoNode(n: FlowNode): boolean {
  const role = (n.data as unknown as { __ioRole?: string }).__ioRole;
  return (
    role === "begin" ||
    role === "end" ||
    role === "agentBoundary" ||
    role === "agentInput" ||
    role === "agentOutput"
  );
}

export function buildConfig(nodes: FlowNode[], edges: FlowEdge[]) {
  const userNodes = nodes.filter((n) => !isIoNode(n));
  const userIds = new Set(userNodes.map((n) => n.id));
  const userEdges = edges.filter((e) => userIds.has(e.source) && userIds.has(e.target));
  return {
    version: 2 as const,
    nodes: userNodes.map((n) => {
      const d = n.data;
      const pos = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      if (d.type === "skill") {
        return {
          id: d.nodeId,
          type: "skill" as const,
          slotIndex: d.slotIndex,
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
      if (d.type === "transform") {
        return {
          id: d.nodeId,
          type: "transform" as const,
          inputFrom: d.inputFrom,
          expression: d.expression,
          position: pos,
        };
      }
      // persist
      return {
        id: d.nodeId,
        type: "persist" as const,
        inputFrom: d.inputFrom,
        position: pos,
      };
    }),
    edges: userEdges.map((e) => ({
      from: e.source,
      to: e.target,
      ...(e.data?.when ? { when: e.data.when } : {}),
    })),
  };
}

// — body-flow conversion (sub-canvas) — — — — — — — — — — — — — — — — —

export function bodyToFlow(body: LoopNodeData["body"]): { nodes: FlowNode[]; edges: FlowEdge[] } {
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
          : nd.type === "transform"
            ? "transformNode"
            : "persistNode",
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

export function flowToBody(nodes: FlowNode[], edges: FlowEdge[]): LoopNodeData["body"] {
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
