"use client";

// Body sub-canvas editor (nested modal). Used by both loop and forEach
// nodes — same ReactFlow canvas, different header copy / iteration
// semantics. Reuses node views + panels from the main canvas. Disallows
// nesting loop / forEach further (UI keeps depth bounded; runtime
// supports MAX_LOOP_DEPTH=2 only via the Advanced raw-JSON editor).
//
// Body source-ref scope is independent — `agent.input` inside the body
// resolves at runtime to:
//   - loop:    the iteration's input (first pass = loop's inputFrom;
//              subsequent passes = previous iteration's leaf output)
//   - forEach: { item, index, total } where item is the current array
//              element. Body reads agent.input.item.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

import type { EquipRow } from "../../types";
import type {
  BodySubCanvasKind,
  FlowEdge,
  FlowNode,
  LoopNodeData,
  NodeData,
} from "./types";
import { bodyToFlow, flowToBody, isIoNode } from "./serialize";
import { nextNodeId } from "./topology";
import { nodeTypes, edgeTypes } from "./nodes/nodeTypes";
import { NodePanel } from "./panels/NodePanel";
import { EdgePanel } from "./panels/EdgePanel";

export type BodySubCanvasEditorProps = {
  parentNodeId: string;
  kind: BodySubCanvasKind;
  initialBody: LoopNodeData["body"];
  equipBySlot: Map<number, EquipRow>;
  onCommit: (body: LoopNodeData["body"]) => void;
  onCancel: () => void;
};

export function BodySubCanvasEditor(props: BodySubCanvasEditorProps) {
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
        data: { type: "skill", nodeId: id, slotIndex: 0, inputFrom: "agent.input" },
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
