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

// persist node — data persistence infrastructure primitive. Resolves
// `inputFrom` to { relicSlug, kind, base64, contentType?, ext? } and writes
// the bytes under private/relics/<slug>/derived/. Output shape mirrors what
// the retired /api/internal/save-asset endpoint returned:
// { savedPath, absPath, bytes, contentType }. Lives at the runtime layer
// (not as a skill) because it's symmetric with runner's `_relicWriteback`
// hook: DB-column persistence + file persistence are both runtime
// infrastructure, not external capabilities.
export type PersistNode = {
  id: string;
  type: "persist";
  inputFrom: SourceRef;
};

export type DagNode =
  | SkillNode
  | BranchNode
  | LoopNode
  | ForEachNode
  | TransformNode
  | PersistNode;
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
  // Intra-step progress callback for long-running skill handlers (HTTP_API
  // polling). Plumbed verbatim into HandlerContext.onProgress via the skill
  // executor. Separate from `onProgress` above which fires between DAG
  // nodes — this one fires inside a single node.
  onSkillProgress?: (snap: { percent?: number; label?: string }) => void | Promise<void>;
  // Resume checkpoint plumbing — only relevant for top-level skill nodes
  // performing submit-then-poll (HTTP_API with `polling`). The skill
  // executor calls `onSkillSubmitted` after the POST half completes so
  // the runner can persist a resume marker, and reads back the persisted
  // `resumeBySkillStepId` map keyed by the prefixed stepId to skip the
  // POST on recovery. Loop / forEach body skills don't participate
  // (multi-iteration semantics make checkpointing ambiguous).
  onSkillSubmitted?: (info: {
    stepId: string;
    skillId: string;
    skillSlug: string;
    initialResponse: unknown;
  }) => void | Promise<void>;
  resumeBySkillStepId?: Map<string, unknown>;
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
