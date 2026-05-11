"use client";

// Backbone DAG editor — React Flow canvas for editing pipelineConfig v2.
//
// Supports five node types — skill / branch / loop / forEach / transform —
// and edges that may carry a `when` label when their source is a branch.
// Loop / forEach bodies are edited in a nested modal sub-canvas; the body
// is persisted as schema-shape `{ nodes, edges }` on the loop node's
// data. UI does not allow nesting a loop inside a loop body (runtime
// allows depth 2 but admin must use Advanced raw JSON for that).
//
// On open: v1 configs are upconverted to a linear v2 graph for editing; on
// save we always write v2. Implementation is split across:
//   backbone/types.ts            — domain types + SLOT_COUNT
//   backbone/serialize.ts        — loadConfig / buildConfig / body conv
//   backbone/topology.ts         — autoLayout / nextNodeId / IO node build
//   backbone/nodes/              — React Flow node + edge components
//   backbone/panels/             — right-side detail panels per node type
//   backbone/BodySubCanvasEditor — nested loop/forEach body editor

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { AgentRow, EquipRow } from "../types";
import type {
  FlowEdge,
  FlowNode,
  NodeData,
  RunLog,
  TestResult,
} from "./backbone/types";
import { buildConfig, isIoNode, loadConfig } from "./backbone/serialize";
import { buildIoEdges, buildIoNodes, nextNodeId } from "./backbone/topology";
import { nodeTypes, edgeTypes } from "./backbone/nodes/nodeTypes";
import { NodePanel } from "./backbone/panels/NodePanel";
import { EdgePanel } from "./backbone/panels/EdgePanel";
import { RunLogTrace } from "./backbone/panels/RunLogTrace";
import { BodySubCanvasEditor } from "./backbone/BodySubCanvasEditor";

type Props = {
  agent: AgentRow;
  equips: EquipRow[];
  onClose: () => void;
};

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
  const ioNodes = useMemo(
    () => buildIoNodes(agent.boundScenes ?? [], initial.nodes, agent.codename),
    [agent.boundScenes, initial.nodes, agent.codename],
  );
  const ioEdges = useMemo(
    () => buildIoEdges(agent.boundScenes ?? [], initial.nodes, initial.edges),
    [agent.boundScenes, initial.nodes, initial.edges],
  );
  const [nodes, setNodes] = useState<FlowNode[]>(() => [...ioNodes, ...initial.nodes]);
  const [edges, setEdges] = useState<FlowEdge[]>(() => [...ioEdges, ...initial.edges]);
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
        data: { type: "skill", nodeId: id, slotIndex: 0, inputFrom: "agent.input" },
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
            nodes: [{ type: "skill", nodeId: seedBodyId, slotIndex: firstSlot, inputFrom: "agent.input" }],
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
            nodes: [{ type: "skill", nodeId: seedBodyId, slotIndex: firstSlot, inputFrom: "agent.input" }],
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
              // Decorative BEGIN / END nodes are read-only — clicking them
              // shouldn't open the right panel (NodePanel can't render
              // them, and they hold no editable state anyway).
              if (isIoNode(n as FlowNode)) {
                setSelectedId(null);
                setSelectedEdgeId(null);
                return;
              }
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
