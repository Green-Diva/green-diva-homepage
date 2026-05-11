// Backbone DAG runtime — shared types.
//
// Mirrors v2 pipelineConfig shape. v1 (legacy linear) is normalized to v2
// at validate time, so all execution lives on these types.

import type { Prisma } from "@prisma/client";
import type { AgentRunLogEntry, AgentRunResult } from "@/lib/agents/invoke";
import type { AgentErrorCode } from "@/lib/agent-errors";

export type SourceRef = string | { merge: Record<string, string> };

export type BranchCase = {
  path: string;
  op: "eq" | "ne" | "in" | "exists";
  value?: unknown;
  label: string;
};

export type SkillNode = {
  id: string;
  type: "skill";
  slotIndex: number;
  inputFrom: SourceRef;
};

export type BranchNode = {
  id: string;
  type: "branch";
  inputFrom: SourceRef;
  cases: BranchCase[];
  defaultLabel?: string;
};

// Loop node — runs `body` sub-DAG up to maxIterations times. Each
// iteration uses the previous iteration's leaf output as its input
// (first iteration uses inputFrom-resolved value). Exits when any
// exitWhen case matches the iteration's leaf output, or when
// maxIterations is reached. Body is a SELF-CONTAINED sub-DAG — its
// node IDs / source refs are scoped to the body; the outer DAG sees the
// loop node as opaque, exposing only the loop's aggregated output.
export type LoopNode = {
  id: string;
  type: "loop";
  inputFrom: SourceRef;
  maxIterations: number;
  exitWhen?: BranchCase[];
  body: { nodes: DagNode[]; edges: DagEdge[] };
  aggregate?: "last" | "concat-array";
};

// forEach node — runs body sub-DAG once per item in the inputFrom-resolved
// array. Body input shape: { item, index, total } — body reads
// agent.input.item etc. Same depth budget as loop (counts toward
// MAX_LOOP_DEPTH). Aggregate default = "concat-array" (forEach is the
// natural shape for "process N items, collect outputs").
export type ForEachNode = {
  id: string;
  type: "forEach";
  inputFrom: SourceRef;
  maxItems: number;
  body: { nodes: DagNode[]; edges: DagEdge[] };
  aggregate?: "last" | "concat-array";
};

// transform node — pure JSONata evaluation, no external calls. Lets DAGs
// do array zip / map / filter / reduce without an INTERNAL helper. The
// expression is parsed once at validate time and re-parsed at runtime
// (jsonata is cheap to instantiate).
export type TransformNode = {
  id: string;
  type: "transform";
  inputFrom: SourceRef;
  expression: string;
};

export type DagNode = SkillNode | BranchNode | LoopNode | ForEachNode | TransformNode;
export type DagEdge = { from: string; to: string; when?: string };
export type DagConfig = { version: 2; nodes: DagNode[]; edges: DagEdge[] };

// Hard cap on loop / forEach nesting — prevents runaway recursion if
// admin accidentally configures deeply nested loops. Two levels covers
// "outer loop coordinates per-item processing, inner loop retries".
export const MAX_LOOP_DEPTH = 2;

// Equip map shape used internally — defined here so the recursive
// runBackbone (sub-DAG invocation from loop bodies) can pass the same
// map down without re-loading from DB. Mirrors the Prisma payload of
// `findMany({ include: { skill: true } })`.
export type BackboneEquip = Prisma.AgentSkillEquipGetPayload<{ include: { skill: true } }>;
export type BackboneEquipMap = Map<number, BackboneEquip>;

// Validation result. `ok=true` => normalized v2 config; `ok=false` =>
// surfaced as a PIPELINE_* error code on AgentRunResult.
export type ValidationOk = { ok: true; config: DagConfig };
export type ValidationFail = { ok: false; code: AgentErrorCode; message: string };

// — — Executor protocol — — — — — — — — — — — — — — — — — — — — — — —
//
// Each per-node executor receives the node + a shared ExecutorCtx. It is
// responsible for:
//   1. Resolving its input via ctx.resolveRef
//   2. Performing its work (skill invoke / branch eval / sub-DAG run / etc.)
//   3. Pushing its own runLog entries to ctx.runLog (executor decides
//      whether to push 1 entry or N — loop / forEach append body trace
//      then their own summary)
//   4. Calling ctx.emitProgress after each meaningful log push
//   5. Returning a NodeExecResult — the dispatcher uses this to decide
//      which outgoing edges become live (branch returns `chosenLabel`)
//      and whether to short-circuit the run on failure.

export type ExecutorCtx = {
  agentId: string;
  agentInput: unknown;
  equipBySlot: BackboneEquipMap;
  depth: number;
  stepIdPrefix: string;
  onProgress?: (info: { runLog: AgentRunLogEntry[] }) => void | Promise<void>;
  resolveRef: (ref: SourceRef) => unknown;
  runLog: AgentRunLogEntry[];
  emitProgress: () => Promise<void>;
  // Recursive sub-DAG entry — injected by the runBackbone wrapper so
  // executors don't import runBackbone directly (avoids a circular
  // module cycle between backbone.ts and executors/).
  runSubDag: (opts: {
    input: unknown;
    body: DagConfig;
    stepIdPrefix: string;
  }) => Promise<AgentRunResult>;
};

export type NodeExecResult =
  | { ok: true; output: unknown; chosenLabel?: string }
  | { ok: false; errorCode: AgentErrorCode; errorMessage: string };
