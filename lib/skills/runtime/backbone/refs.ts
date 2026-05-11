// Source-ref parsing + value resolution + branch case evaluation.
//
// SourceRef shapes:
//   - "agent.input[.path]"          — agent's root input
//   - "<nodeId>.output[.path]"      — output of a prior node
//   - { merge: { keyA: "<refA>" } } — assembled object whose values are
//                                     resolved sources (skipped → null)

import type { BranchCase, SourceRef } from "./types";

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Matches "agent.input[.path]" or "<nodeId>.output[.path]" and breaks
// out the head (so we can resolve it) plus the dot-path tail (so we can
// drill into the resolved value). Returns null on malformed input.
const SOURCE_REF_HEAD_RE = /^(agent\.input|[a-zA-Z0-9_-]+\.output)((?:\.[a-zA-Z0-9_]+)*)$/;

export function isValidSourceRefString(s: string): boolean {
  return SOURCE_REF_HEAD_RE.test(s);
}

export function splitRef(ref: string): { head: string; tail: string } | null {
  const m = ref.match(SOURCE_REF_HEAD_RE);
  if (!m) return null;
  // m[2] is "" or starts with "." — strip leading dot.
  const tail = m[2] ? m[2].slice(1) : "";
  return { head: m[1], tail };
}

export function parseSourceRef(ref: unknown): SourceRef | null {
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

export function refDependencies(ref: SourceRef): string[] {
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

export function pickPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function evalCase(input: unknown, c: BranchCase): boolean {
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

// Resolve a SourceRef given the agent's input and a snapshot of prior
// node outputs. `skippedNodes` resolves to `null` so a downstream merge
// can detect "branch didn't run" without confusing it for "node didn't
// emit a value". `agent.input` is always available regardless of liveness.
export function resolveSourceRef(
  ref: SourceRef,
  agentInput: unknown,
  outputs: Map<string, unknown>,
  skippedNodes: Set<string>,
): unknown {
  const lookupOne = (s: string): unknown => {
    const split = splitRef(s);
    if (!split) return undefined;
    let base: unknown;
    if (split.head === "agent.input") {
      base = agentInput;
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
}
