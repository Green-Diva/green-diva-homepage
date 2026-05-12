// Domain types for the Backbone DAG editor — mirrors lib/skills/runtime/backbone.ts.

import type { Node, Edge } from "@xyflow/react";

export const SLOT_COUNT = 6;

export type SourceRef = string | { merge: Record<string, string> };

export type BranchCase = {
  path: string;
  op: "eq" | "ne" | "in" | "exists";
  value?: unknown;
  label: string;
};

export type SkillNodeData = {
  type: "skill";
  nodeId: string;
  slotIndex: number;
  inputFrom: SourceRef;
};

export type BranchNodeData = {
  type: "branch";
  nodeId: string;
  inputFrom: SourceRef;
  cases: BranchCase[];
  defaultLabel?: string;
};

// Body sub-DAG can contain skill / branch / transform / persist — UI
// disallows nested loops / forEach (runtime supports MAX_LOOP_DEPTH=2 only
// via raw JSON).
export type BodyNodeData =
  | SkillNodeData
  | BranchNodeData
  | TransformNodeData
  | PersistNodeData;
export type BodyEdge = { from: string; to: string; when?: string };

export type LoopNodeData = {
  type: "loop";
  nodeId: string;
  inputFrom: SourceRef;
  maxIterations: number;
  exitWhen: BranchCase[];
  aggregate: "last" | "concat-array";
  body: { nodes: BodyNodeData[]; edges: BodyEdge[]; positions?: Record<string, { x: number; y: number }> };
};

export type ForEachNodeData = {
  type: "forEach";
  nodeId: string;
  inputFrom: SourceRef;
  maxItems: number;
  aggregate: "last" | "concat-array";
  body: { nodes: BodyNodeData[]; edges: BodyEdge[]; positions?: Record<string, { x: number; y: number }> };
};

export type TransformNodeData = {
  type: "transform";
  nodeId: string;
  inputFrom: SourceRef;
  expression: string;
};

export type PersistNodeData = {
  type: "persist";
  nodeId: string;
  inputFrom: SourceRef;
};

export type NodeData =
  | SkillNodeData
  | BranchNodeData
  | LoopNodeData
  | ForEachNodeData
  | TransformNodeData
  | PersistNodeData;

export type FlowNode = Node<NodeData>;

export type EdgeData = { when?: string };
export type FlowEdge = Edge<EdgeData>;

// Decorative I/O nodes (BEGIN / END / AGENT-BOUNDARY) — read-only, filtered from buildConfig.
export type BeginEndFieldHint = { name: string; type: string; optional: boolean };

export type BeginNodeData = {
  __ioRole: "begin";
  sceneKey: string;
  sceneLabel: string;
  invocation: "sync" | "async";
  fields: BeginEndFieldHint[];
  // "binding" = production-routable SceneBinding row exists.
  // "intent"  = draft-phase claim only; deploy will materialize.
  via: "binding" | "intent";
};

export type EndNodeData = {
  __ioRole: "end";
  sceneKey: string;
  sceneLabel: string;
  invocation: "sync" | "async";
  fields: BeginEndFieldHint[];
  via: "binding" | "intent";
};

export type AgentBoundaryData = {
  __ioRole: "agentBoundary";
  codename: string;
};

// Single convergence point: where the scene-resolved `agent.input` enters the
// DAG (one input per invocation, regardless of which BEGIN-side scene
// triggered). Decorative — not serialized into pipelineConfig.
export type AgentInputNodeData = {
  __ioRole: "agentInput";
};

// Single convergence point: where the DAG's leaf output emerges, then fans
// out (decoratively) to whichever scene's END contract validates it. One
// output per invocation; the END selected at runtime depends on which scene
// invoked.
export type AgentOutputNodeData = {
  __ioRole: "agentOutput";
};

export type BodySubCanvasKind = "loop" | "forEach";

export type RunLog = Array<{
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

export type TestResult =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; output: unknown; runLog: RunLog; durationMs: number }
  | { kind: "err"; errorCode: string; errorMessage: string; runLog: RunLog };
