// Backbone (MECHANICAL) executor — DAG runtime (Phase 5, 2026-05-09).
//
// Accepts pipelineConfig v1 (legacy linear) and v2 (DAG with branch nodes).
// v1 is normalized to v2 at entry so all execution lives in one codepath.
//
// v2 shape:
//   {
//     version: 2,
//     nodes: [
//       { id, type: "skill", equipSlot, inputFrom },             // run a skill
//       { id, type: "branch", inputFrom, cases, defaultLabel? }  // route by condition
//     ],
//     edges: [
//       { from, to, when? }     // when required iff source is a branch
//     ]
//   }
//
// Source ref (used by inputFrom):
//   - "agent.input"
//   - "<nodeId>.output"
//   - { merge: { keyA: "<refA>", keyB: "<refB>", ... } } — assembles an
//     object whose values are the resolved sources (skipped sources → null)
//
// Liveness: a node runs iff at least one incoming edge is live. Edges from
// skill nodes become live once the skill ran. Edges from branch nodes are
// live only for the matching `when` label. Final agent output = the topo-last
// live leaf's output (a leaf = node with no outgoing edges).

import "server-only";
import { prisma } from "@/lib/db";
import { invokeSkill } from "@/lib/skills/invoke";
import type { AgentRunResult, AgentRunLogEntry } from "@/lib/agents/invoke";

// — — Types — — — — — — — — — — — — — — — — — — — — — — — — — — — — —

type SourceRef = string | { merge: Record<string, string> };

type BranchCase = {
  path: string;
  op: "eq" | "ne" | "in" | "exists";
  value?: unknown;
  label: string;
};

type SkillNode = {
  id: string;
  type: "skill";
  equipSlot: number;
  inputFrom: SourceRef;
};

type BranchNode = {
  id: string;
  type: "branch";
  inputFrom: SourceRef;
  cases: BranchCase[];
  defaultLabel?: string;
};

type DagNode = SkillNode | BranchNode;
type DagEdge = { from: string; to: string; when?: string };
type DagConfig = { version: 2; nodes: DagNode[]; edges: DagEdge[] };

// — — Validation + v1 → v2 normalization — — — — — — — — — — — — — — —

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Matches "agent.input[.path]" or "<nodeId>.output[.path]" and breaks out
// the head (so we can resolve it) plus the dot-path tail (so we can drill
// into the resolved value). Returns null on malformed input.
const SOURCE_REF_HEAD_RE = /^(agent\.input|[a-zA-Z0-9_-]+\.output)((?:\.[a-zA-Z0-9_]+)*)$/;

function isValidSourceRefString(s: string): boolean {
  return SOURCE_REF_HEAD_RE.test(s);
}

function splitRef(ref: string): { head: string; tail: string } | null {
  const m = ref.match(SOURCE_REF_HEAD_RE);
  if (!m) return null;
  // m[2] is "" or starts with "." — strip leading dot.
  const tail = m[2] ? m[2].slice(1) : "";
  return { head: m[1], tail };
}

function parseSourceRef(ref: unknown): SourceRef | null {
  if (typeof ref === "string") {
    return isValidSourceRefString(ref) ? ref : null;
  }
  if (isObject(ref) && isObject(ref.merge)) {
    const merge: Record<string, string> = {};
    for (const [k, v] of Object.entries(ref.merge)) {
      if (typeof v !== "string") return null;
      if (!isValidSourceRefString(v)) return null;
      merge[k] = v;
    }
    return { merge };
  }
  return null;
}

function refDependencies(ref: SourceRef): string[] {
  const deps: string[] = [];
  const add = (s: string) => {
    const split = splitRef(s);
    if (!split || split.head === "agent.input") return;
    const m = split.head.match(/^([a-zA-Z0-9_-]+)\.output$/);
    if (m) deps.push(m[1]);
  };
  if (typeof ref === "string") add(ref);
  else for (const v of Object.values(ref.merge)) add(v);
  return deps;
}

// v1 → v2: each step becomes a skill node; an edge is added from each
// referenced upstream step. Linear topology falls out naturally.
function normalizeV1ToV2(cfg: { version: 1; steps: unknown }): DagConfig | null {
  if (!Array.isArray(cfg.steps)) return null;
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];
  for (const raw of cfg.steps) {
    if (!isObject(raw)) return null;
    const id = typeof raw.id === "string" ? raw.id : null;
    if (!id) return null;
    const equipSlot = raw.equipSlot;
    if (typeof equipSlot !== "number" || !Number.isInteger(equipSlot)) return null;
    if (!isObject(raw.inputMapping)) return null;
    const ref = parseSourceRef(raw.inputMapping.from);
    if (!ref) return null;
    nodes.push({ id, type: "skill", equipSlot, inputFrom: ref });
    for (const dep of refDependencies(ref)) {
      edges.push({ from: dep, to: id });
    }
  }
  return { version: 2, nodes, edges };
}

type ValidationOk = { ok: true; config: DagConfig };
type ValidationFail = { ok: false; code: string; message: string };

function validateAndNormalize(cfg: unknown): ValidationOk | ValidationFail {
  if (!isObject(cfg)) {
    return {
      ok: false,
      code: "PIPELINE_MISSING",
      message: "pipelineConfig is empty — set up the Backbone before invoking",
    };
  }
  if (cfg.version === 1) {
    const v2 = normalizeV1ToV2(cfg as { version: 1; steps: unknown });
    if (!v2) {
      return { ok: false, code: "PIPELINE_INVALID", message: "v1 pipelineConfig is malformed" };
    }
    return checkDag(v2);
  }
  if (cfg.version !== 2) {
    return {
      ok: false,
      code: "PIPELINE_VERSION",
      message: `pipelineConfig.version must be 1 or 2 (got ${String(cfg.version)})`,
    };
  }
  if (!Array.isArray(cfg.nodes) || !Array.isArray(cfg.edges)) {
    return { ok: false, code: "PIPELINE_INVALID", message: "v2 pipelineConfig must have nodes[] and edges[]" };
  }

  const nodes: DagNode[] = [];
  for (const [i, raw] of (cfg.nodes as unknown[]).entries()) {
    if (!isObject(raw)) return { ok: false, code: "PIPELINE_INVALID", message: `node[${i}] is not an object` };
    const id = typeof raw.id === "string" ? raw.id : null;
    if (!id) return { ok: false, code: "PIPELINE_INVALID", message: `node[${i}].id missing` };
    const inputRef = parseSourceRef(raw.inputFrom);
    if (!inputRef) {
      return { ok: false, code: "PIPELINE_INVALID", message: `node "${id}".inputFrom invalid` };
    }
    if (raw.type === "skill") {
      const slot = raw.equipSlot;
      if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot > 5) {
        return { ok: false, code: "PIPELINE_INVALID", message: `node "${id}".equipSlot must be 0-5` };
      }
      nodes.push({ id, type: "skill", equipSlot: slot, inputFrom: inputRef });
    } else if (raw.type === "branch") {
      if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
        return { ok: false, code: "PIPELINE_INVALID", message: `branch "${id}" must have ≥1 case` };
      }
      const cases: BranchCase[] = [];
      for (const [j, c] of raw.cases.entries()) {
        if (!isObject(c)) {
          return { ok: false, code: "PIPELINE_INVALID", message: `branch "${id}".cases[${j}] not an object` };
        }
        const path = typeof c.path === "string" ? c.path : null;
        if (path === null) {
          return { ok: false, code: "PIPELINE_INVALID", message: `branch "${id}".cases[${j}].path missing` };
        }
        if (c.op !== "eq" && c.op !== "ne" && c.op !== "in" && c.op !== "exists") {
          return { ok: false, code: "PIPELINE_INVALID", message: `branch "${id}".cases[${j}].op invalid` };
        }
        const label = typeof c.label === "string" ? c.label : null;
        if (!label) {
          return { ok: false, code: "PIPELINE_INVALID", message: `branch "${id}".cases[${j}].label missing` };
        }
        cases.push({ path, op: c.op, value: c.value, label });
      }
      const defaultLabel = typeof raw.defaultLabel === "string" ? raw.defaultLabel : undefined;
      nodes.push({ id, type: "branch", inputFrom: inputRef, cases, defaultLabel });
    } else {
      return {
        ok: false,
        code: "PIPELINE_INVALID",
        message: `node "${id}".type must be "skill" or "branch"`,
      };
    }
  }

  const edges: DagEdge[] = [];
  for (const [i, raw] of (cfg.edges as unknown[]).entries()) {
    if (!isObject(raw)) return { ok: false, code: "PIPELINE_INVALID", message: `edge[${i}] not an object` };
    const from = typeof raw.from === "string" ? raw.from : null;
    const to = typeof raw.to === "string" ? raw.to : null;
    if (!from || !to) return { ok: false, code: "PIPELINE_INVALID", message: `edge[${i}] missing from/to` };
    const when = typeof raw.when === "string" ? raw.when : undefined;
    edges.push({ from, to, when });
  }

  return checkDag({ version: 2, nodes, edges });
}

function checkDag(dag: DagConfig): ValidationOk | ValidationFail {
  const nodeById = new Map<string, DagNode>();
  for (const n of dag.nodes) {
    if (nodeById.has(n.id)) {
      return { ok: false, code: "PIPELINE_INVALID", message: `duplicate node id "${n.id}"` };
    }
    nodeById.set(n.id, n);
  }

  for (const e of dag.edges) {
    const src = nodeById.get(e.from);
    if (!src) return { ok: false, code: "PIPELINE_INVALID", message: `edge from unknown node "${e.from}"` };
    if (!nodeById.get(e.to)) {
      return { ok: false, code: "PIPELINE_INVALID", message: `edge to unknown node "${e.to}"` };
    }
    if (src.type === "branch") {
      if (!e.when) {
        return {
          ok: false,
          code: "PIPELINE_INVALID",
          message: `edge from branch "${e.from}" must specify when`,
        };
      }
      const labels = new Set(src.cases.map((c) => c.label));
      if (src.defaultLabel) labels.add(src.defaultLabel);
      if (!labels.has(e.when)) {
        return {
          ok: false,
          code: "PIPELINE_INVALID",
          message: `edge from branch "${e.from}" has when="${e.when}" not declared in cases`,
        };
      }
    }
  }

  for (const n of dag.nodes) {
    for (const dep of refDependencies(n.inputFrom)) {
      if (!nodeById.has(dep)) {
        return {
          ok: false,
          code: "PIPELINE_INVALID",
          message: `node "${n.id}".inputFrom references unknown "${dep}"`,
        };
      }
    }
  }

  // Topological sort (Kahn). Detects cycles.
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of dag.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of dag.edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    adj.get(e.from)!.push(e.to);
  }
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== dag.nodes.length) {
    return { ok: false, code: "PIPELINE_INVALID", message: "cycle detected in DAG" };
  }

  return { ok: true, config: dag };
}

// — — Branch evaluation — — — — — — — — — — — — — — — — — — — — — — —

function pickPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function evalCase(input: unknown, c: BranchCase): boolean {
  const v = pickPath(input, c.path);
  switch (c.op) {
    case "eq":
      return v === c.value;
    case "ne":
      return v !== c.value;
    case "exists":
      return v !== undefined && v !== null;
    case "in":
      return Array.isArray(c.value) && c.value.includes(v);
  }
}

// — — Executor — — — — — — — — — — — — — — — — — — — — — — — — — — —

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
}): Promise<AgentRunResult> {
  const v = validateAndNormalize(opts.pipelineConfig);
  if (!v.ok) {
    return { ok: false, errorCode: v.code, errorMessage: v.message, runLog: [] };
  }
  const config = v.config;
  const emitProgress = async () => {
    if (!opts.onProgress) return;
    try {
      await opts.onProgress({ runLog });
    } catch (e) {
      console.warn("[backbone] onProgress threw, swallowing", e);
    }
  };

  const equips = await prisma.agentSkillEquip.findMany({
    where: { agentId: opts.agentId, slotIndex: { not: null } },
    include: { skill: true },
  });
  const equipBySlot = new Map<number, (typeof equips)[number]>();
  for (const e of equips) {
    if (e.slotIndex !== null) equipBySlot.set(e.slotIndex, e);
  }

  // Topo order for traversal.
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

  const nodeById = new Map(config.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, DagEdge[]>();
  for (const n of config.nodes) incoming.set(n.id, []);
  for (const e of config.edges) incoming.get(e.to)!.push(e);

  const liveEdges = new Set<string>();
  const edgeKey = (e: DagEdge) => `${e.from}->${e.to}|${e.when ?? ""}`;
  const liveNodes = new Set<string>();
  const skippedNodes = new Set<string>();
  const outputs = new Map<string, unknown>();
  const runLog: AgentRunLogEntry[] = [];

  // Skipped sources resolve to null so a downstream merge can detect "branch
  // didn't run". `agent.input` is always available regardless of liveness.
  const resolveRef = (ref: SourceRef): unknown => {
    const lookupOne = (s: string): unknown => {
      const split = splitRef(s);
      if (!split) return undefined;
      let base: unknown;
      if (split.head === "agent.input") {
        base = opts.input;
      } else {
        const m = split.head.match(/^([a-zA-Z0-9_-]+)\.output$/);
        if (!m) return undefined;
        const nodeId = m[1];
        if (skippedNodes.has(nodeId)) return null;
        base = outputs.get(nodeId);
      }
      return split.tail ? pickPath(base, split.tail) : base;
    };
    if (typeof ref === "string") return lookupOne(ref);
    const merged: Record<string, unknown> = {};
    for (const [k, src] of Object.entries(ref.merge)) {
      merged[k] = lookupOne(src);
    }
    return merged;
  };

  const failNode = (
    nodeId: string,
    code: string,
    message: string,
    extras?: { skillId?: string; output?: unknown },
  ): AgentRunResult => {
    const now = new Date();
    runLog.push({
      stepId: nodeId,
      skillId: extras?.skillId,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationMs: 0,
      ok: false,
      errorCode: code,
      errorMessage: message,
      output: extras?.output,
    });
    return { ok: false, errorCode: code, errorMessage: `node "${nodeId}": ${message}`, runLog };
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
        stepId: id,
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        durationMs: 0,
        ok: true,
        skipped: true,
      });
      await emitProgress();
      continue;
    }

    const startedAt = new Date();
    const startMs = Date.now();

    if (node.type === "skill") {
      const equip = equipBySlot.get(node.equipSlot);
      if (!equip) {
        return failNode(id, "SLOT_EMPTY", `slot ${node.equipSlot} has no equipped skill`);
      }
      if (equip.skill.status === "OFFLINE") {
        return failNode(
          id,
          "SKILL_OFFLINE",
          `skill "${equip.skill.nameEn}" is OFFLINE — flip status to ONLINE in Skill Library`,
          { skillId: equip.skill.id },
        );
      }
      const stepInput = resolveRef(node.inputFrom);
      const invokeResult = await invokeSkill(equip.skill, stepInput);
      const endedAt = new Date();
      if (!invokeResult.ok) {
        runLog.push({
          stepId: id,
          skillId: equip.skill.id,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - startMs,
          ok: false,
          errorCode: invokeResult.errorCode,
          errorMessage: invokeResult.errors.join("; "),
          output: invokeResult.output,
        });
        return {
          ok: false,
          errorCode: invokeResult.errorCode,
          errorMessage: `node "${id}" failed (${invokeResult.errorCode}): ${invokeResult.errors.join("; ")}`,
          runLog,
        };
      }
      outputs.set(id, invokeResult.output);
      liveNodes.add(id);
      runLog.push({
        stepId: id,
        skillId: equip.skill.id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startMs,
        ok: true,
        output: invokeResult.output,
      });
      for (const e of config.edges) if (e.from === id) liveEdges.add(edgeKey(e));
      await emitProgress();
    } else {
      const branchInput = resolveRef(node.inputFrom);
      let chosenLabel: string | undefined;
      for (const c of node.cases) {
        if (evalCase(branchInput, c)) {
          chosenLabel = c.label;
          break;
        }
      }
      if (!chosenLabel) chosenLabel = node.defaultLabel;
      const endedAt = new Date();
      if (!chosenLabel) {
        return failNode(
          id,
          "BRANCH_NO_MATCH",
          `branch "${id}" matched no case and has no defaultLabel`,
          { output: branchInput },
        );
      }
      if (!config.edges.some((e) => e.from === id && e.when === chosenLabel)) {
        return failNode(
          id,
          "BRANCH_NO_EDGE",
          `branch "${id}" chose "${chosenLabel}" but no outgoing edge has when="${chosenLabel}"`,
          { output: branchInput },
        );
      }
      outputs.set(id, { branch: chosenLabel, value: branchInput });
      liveNodes.add(id);
      runLog.push({
        stepId: id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startMs,
        ok: true,
        branchLabel: chosenLabel,
        output: branchInput,
      });
      for (const e of config.edges) {
        if (e.from === id && e.when === chosenLabel) liveEdges.add(edgeKey(e));
      }
      await emitProgress();
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
