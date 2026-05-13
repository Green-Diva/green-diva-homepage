// Backbone (MECHANICAL) executor — DAG runtime entry point.
//
// Accepts pipelineConfig v1 (legacy linear) and v2 (DAG with branch /
// loop / forEach / transform nodes). v1 is normalized to v2 at entry so
// all execution lives in one codepath.
//
// Implementation lives in ./backbone/:
//   types.ts          — DagNode / DagEdge / ExecutorCtx / NodeExecResult
//   refs.ts           — SourceRef parse + resolve + pickPath + evalCase
//   validate.ts       — validateAndNormalize + checkDag + v1→v2
//   executors/        — per-node-type executor functions
//
// This file owns the topo traversal + liveness propagation + executor
// dispatch + sub-DAG recursion. Each node type's logic lives in its
// own executor, called via executors[node.type](node, ctx).
//
// Liveness: a node runs iff at least one incoming edge is live. Edges
// from skill / loop / forEach / transform nodes become live once the
// node succeeded. Edges from branch nodes are live only for the
// matching `when` label. Final agent output = the topo-last live leaf's
// output (leaf = node with no outgoing edges).

import "server-only";
import { prisma } from "@/lib/db";
import type { AgentRunResult, AgentRunLogEntry } from "@/lib/agents/invoke";
import {
  executeBranchNode,
  executeForEachNode,
  executeLoopNode,
  executePersistNode,
  executeSkillNode,
  executeTransformNode,
} from "./backbone/executors";
import { resolveSourceRef } from "./backbone/refs";
import type {
  BackboneEquipMap,
  DagConfig,
  DagEdge,
  ExecutorCtx,
  SourceRef,
} from "./backbone/types";
import { validateAndNormalize } from "./backbone/validate";

export async function runBackbone(opts: {
  agentId: string;
  input: unknown;
  pipelineConfig: unknown;
  // Streaming hook: invoked after each node settles (success / fail / skip)
  // with the current cumulative runLog. Lets the caller persist intermediate
  // progress (e.g. RelicDraft.progress + pipelineTrace) so UIs don't sit at
  // the same percentage for the duration of a long step. Errors thrown by
  // the callback are swallowed — progress reporting must never break a run.
  onProgress?: (info: { runLog: AgentRunLogEntry[] }) => void | Promise<void>;
  // Intra-step skill progress hook — fires inside a long-running handler
  // (currently HTTP_API polling). Distinct from `onProgress` which fires
  // between DAG nodes. Threaded through ExecutorCtx → invokeSkill →
  // HandlerContext.onProgress.
  onSkillProgress?: (snap: { percent?: number; label?: string }) => void | Promise<void>;
  // INTERNAL — recursive sub-DAG invocations from loop / forEach set these.
  // _internalEquips: skip the DB equip lookup (parent already has it).
  // _depth: track nesting for MAX_LOOP_DEPTH enforcement.
  // _runLog: append to caller's runLog (so body entries land in the same
  //          trace, prefixed with the iteration).
  // _stepIdPrefix: e.g. "imageLoop#2/" — prefixes every entry's stepId.
  _internalEquips?: BackboneEquipMap;
  _depth?: number;
  _runLog?: AgentRunLogEntry[];
  _stepIdPrefix?: string;
}): Promise<AgentRunResult> {
  const v = validateAndNormalize(opts.pipelineConfig);
  if (!v.ok) {
    return { ok: false, errorCode: v.code, errorMessage: v.message, runLog: opts._runLog ?? [] };
  }
  const config = v.config;
  const stepIdPrefix = opts._stepIdPrefix ?? "";
  const depth = opts._depth ?? 0;
  // Sub-DAG invocations append to the caller's runLog so all entries
  // (including loop body iterations) end up in one unified trace.
  const runLog: AgentRunLogEntry[] = opts._runLog ?? [];
  const emitProgress = async () => {
    if (!opts.onProgress) return;
    try {
      await opts.onProgress({ runLog });
    } catch (e) {
      console.warn("[backbone] onProgress threw, swallowing", e);
    }
  };

  // Equip lookup: top-level invocations hit DB; sub-DAG invocations
  // (loop / forEach body) reuse the parent's equip map.
  let equipBySlot: BackboneEquipMap;
  if (opts._internalEquips) {
    equipBySlot = opts._internalEquips;
  } else {
    const equips = await prisma.agentSkillEquip.findMany({
      where: { agentId: opts.agentId, slotIndex: { not: null } },
      include: { skill: true },
    });
    equipBySlot = new Map();
    for (const e of equips) {
      if (e.slotIndex !== null) equipBySlot.set(e.slotIndex, e);
    }
  }

  // Topo order for traversal.
  const topo = topoSort(config);

  const nodeById = new Map(config.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, DagEdge[]>();
  for (const n of config.nodes) incoming.set(n.id, []);
  for (const e of config.edges) incoming.get(e.to)!.push(e);

  const liveEdges = new Set<string>();
  const edgeKey = (e: DagEdge) => `${e.from}->${e.to}|${e.when ?? ""}`;
  const liveNodes = new Set<string>();
  const skippedNodes = new Set<string>();
  const outputs = new Map<string, unknown>();

  const resolveRef = (ref: SourceRef): unknown =>
    resolveSourceRef(ref, opts.input, outputs, skippedNodes);

  const runSubDag: ExecutorCtx["runSubDag"] = (subOpts) =>
    runBackbone({
      agentId: opts.agentId,
      input: subOpts.input,
      pipelineConfig: subOpts.body,
      onProgress: opts.onProgress,
      onSkillProgress: opts.onSkillProgress,
      _internalEquips: equipBySlot,
      _depth: depth + 1,
      _runLog: runLog,
      _stepIdPrefix: subOpts.stepIdPrefix,
    });

  const ctx: ExecutorCtx = {
    agentId: opts.agentId,
    agentInput: opts.input,
    equipBySlot,
    depth,
    stepIdPrefix,
    onProgress: opts.onProgress,
    onSkillProgress: opts.onSkillProgress,
    resolveRef,
    runLog,
    emitProgress,
    runSubDag,
  };

  for (const id of topo) {
    const node = nodeById.get(id)!;
    const inEdges = incoming.get(id) ?? [];
    const isLive =
      inEdges.length === 0 ? true : inEdges.some((e) => liveEdges.has(edgeKey(e)));

    if (!isLive) {
      skippedNodes.add(id);
      const now = new Date();
      runLog.push({
        stepId: stepIdPrefix + id,
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        durationMs: 0,
        ok: true,
        skipped: true,
      });
      await emitProgress();
      continue;
    }

    let result;
    if (node.type === "skill") {
      result = await executeSkillNode(node, ctx);
    } else if (node.type === "branch") {
      const outgoingLabels = new Set<string>();
      for (const e of config.edges) {
        if (e.from === id && e.when) outgoingLabels.add(e.when);
      }
      result = await executeBranchNode(node, ctx, outgoingLabels);
    } else if (node.type === "loop") {
      result = await executeLoopNode(node, ctx);
    } else if (node.type === "forEach") {
      result = await executeForEachNode(node, ctx);
    } else if (node.type === "transform") {
      result = await executeTransformNode(node, ctx);
    } else {
      result = await executePersistNode(node, ctx);
    }

    if (!result.ok) {
      return {
        ok: false,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        runLog,
      };
    }

    outputs.set(id, result.output);
    liveNodes.add(id);
    for (const e of config.edges) {
      if (e.from !== id) continue;
      if (node.type === "branch") {
        if (e.when === result.chosenLabel) liveEdges.add(edgeKey(e));
      } else {
        liveEdges.add(edgeKey(e));
      }
    }
  }

  // Final output = last live leaf in topo order. Leaf = node with outDeg=0.
  const outDeg = new Map<string, number>();
  for (const n of config.nodes) outDeg.set(n.id, 0);
  for (const e of config.edges) outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
  let finalOutput: unknown;
  let foundLeaf = false;
  for (const id of topo) {
    if (outDeg.get(id) === 0 && liveNodes.has(id)) {
      finalOutput = outputs.get(id);
      foundLeaf = true;
    }
  }
  if (!foundLeaf) {
    return {
      ok: false,
      errorCode: "PIPELINE_DEAD_END",
      errorMessage: "no leaf node became live — DAG produces no output",
      runLog,
    };
  }

  return { ok: true, output: finalOutput, runLog };
}

function topoSort(config: DagConfig): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of config.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of config.edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    adj.get(e.from)!.push(e.to);
  }
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  const topo: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    topo.push(id);
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  return topo;
}
