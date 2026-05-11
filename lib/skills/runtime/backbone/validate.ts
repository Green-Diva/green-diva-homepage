// pipelineConfig validation + v1 → v2 normalization. JSONata expressions
// are parsed once here so malformed transforms fail at validate time
// rather than mid-run.

import jsonata from "jsonata";
import {
  isObject,
  parseSourceRef,
  refDependencies,
} from "./refs";
import type {
  BranchCase,
  DagConfig,
  DagEdge,
  DagNode,
  ValidationFail,
  ValidationOk,
} from "./types";

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
    const slotIndex = raw.slotIndex;
    if (typeof slotIndex !== "number" || !Number.isInteger(slotIndex)) return null;
    if (!isObject(raw.inputMapping)) return null;
    const ref = parseSourceRef(raw.inputMapping.from);
    if (!ref) return null;
    nodes.push({ id, type: "skill", slotIndex, inputFrom: ref });
    for (const dep of refDependencies(ref)) {
      edges.push({ from: dep, to: id });
    }
  }
  return { version: 2, nodes, edges };
}

export function validateAndNormalize(cfg: unknown): ValidationOk | ValidationFail {
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
      const slot = raw.slotIndex;
      if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot > 5) {
        return { ok: false, code: "PIPELINE_INVALID", message: `node "${id}".slotIndex must be 0-5` };
      }
      nodes.push({ id, type: "skill", slotIndex: slot, inputFrom: inputRef });
    } else if (raw.type === "loop") {
      const maxIter = raw.maxIterations;
      if (typeof maxIter !== "number" || !Number.isInteger(maxIter) || maxIter < 1 || maxIter > 10) {
        return { ok: false, code: "PIPELINE_INVALID", message: `loop "${id}".maxIterations must be 1-10` };
      }
      // exitWhen reuses BranchCase shape — admin sets `label` to any
      // non-empty string; we ignore the label since loop exit isn't via
      // labeled edges.
      const exitWhen: BranchCase[] | undefined = (() => {
        if (raw.exitWhen === undefined) return undefined;
        if (!Array.isArray(raw.exitWhen)) return undefined;
        const cases: BranchCase[] = [];
        for (const c of raw.exitWhen) {
          if (!isObject(c)) continue;
          const path = typeof c.path === "string" ? c.path : null;
          if (path === null) continue;
          if (c.op !== "eq" && c.op !== "ne" && c.op !== "in" && c.op !== "exists") continue;
          const label = typeof c.label === "string" && c.label ? c.label : "exit";
          cases.push({ path, op: c.op, value: c.value, label });
        }
        return cases;
      })();
      if (!isObject(raw.body) || !Array.isArray(raw.body.nodes) || !Array.isArray(raw.body.edges)) {
        return { ok: false, code: "PIPELINE_INVALID", message: `loop "${id}".body must have nodes[] + edges[]` };
      }
      const bodyValidated = validateAndNormalize({
        version: 2,
        nodes: raw.body.nodes,
        edges: raw.body.edges,
      });
      if (!bodyValidated.ok) {
        return {
          ok: false,
          code: "PIPELINE_INVALID",
          message: `loop "${id}".body invalid: ${bodyValidated.message}`,
        };
      }
      const aggregate = raw.aggregate === "concat-array" ? "concat-array" : "last";
      nodes.push({
        id,
        type: "loop",
        inputFrom: inputRef,
        maxIterations: maxIter,
        exitWhen,
        body: bodyValidated.config,
        aggregate,
      });
    } else if (raw.type === "forEach") {
      const maxItems = raw.maxItems;
      if (typeof maxItems !== "number" || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50) {
        return { ok: false, code: "PIPELINE_INVALID", message: `forEach "${id}".maxItems must be 1-50` };
      }
      if (!isObject(raw.body) || !Array.isArray(raw.body.nodes) || !Array.isArray(raw.body.edges)) {
        return { ok: false, code: "PIPELINE_INVALID", message: `forEach "${id}".body must have nodes[] + edges[]` };
      }
      const bodyValidated = validateAndNormalize({
        version: 2,
        nodes: raw.body.nodes,
        edges: raw.body.edges,
      });
      if (!bodyValidated.ok) {
        return {
          ok: false,
          code: "PIPELINE_INVALID",
          message: `forEach "${id}".body invalid: ${bodyValidated.message}`,
        };
      }
      // Default concat-array — forEach's natural shape is "process N
      // items, collect N outputs". Admin can override to "last" if only
      // the final iteration's output matters (e.g. reduction-style fold).
      const aggregate = raw.aggregate === "last" ? "last" : "concat-array";
      nodes.push({
        id,
        type: "forEach",
        inputFrom: inputRef,
        maxItems,
        body: bodyValidated.config,
        aggregate,
      });
    } else if (raw.type === "transform") {
      const expression = typeof raw.expression === "string" ? raw.expression.trim() : "";
      if (!expression) {
        return { ok: false, code: "PIPELINE_INVALID", message: `transform "${id}".expression required` };
      }
      // Parse-once check — JSONata throws on malformed expressions.
      try {
        jsonata(expression);
      } catch (e) {
        return {
          ok: false,
          code: "PIPELINE_INVALID",
          message: `transform "${id}".expression parse failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      nodes.push({ id, type: "transform", inputFrom: inputRef, expression });
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
        message: `node "${id}".type must be "skill" | "branch" | "loop" | "forEach" | "transform"`,
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

export function checkDag(dag: DagConfig): ValidationOk | ValidationFail {
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
    // Loop / forEach nodes have unlabeled outgoing edges — no `when` validation.
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
