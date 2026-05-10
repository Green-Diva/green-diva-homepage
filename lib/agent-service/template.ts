// Template engine for SceneBinding.inputMap / outputMap.
//
// Syntax — single placeholder per cell: `{{path.to.value}}`.
//   - Whole-string match → returns the raw looked-up value (preserves
//     number / object / array type). Use this for non-string fields.
//       e.g. { _relicId: "{{ctx.relicId}}", opts: "{{ctx.opts}}" }
//   - Embedded match → string interpolation; non-string values are
//     JSON.stringified so {{actor}} inside prose still serializes.
//       e.g. { note: "Triggered by {{actor.name}} for {{ctx.relicId}}" }
//
// Variables are conventionally { ctx, actor }. The engine itself doesn't
// care — caller picks the namespace. Missing paths resolve to undefined
// (whole-value) or empty string (interpolated); they DO NOT throw, so
// downstream zod schema validation gets the chance to give a much better
// error pointing at which field broke.

import "server-only";

// Path chars include dash so backbone node IDs like "research-regen" can
// be referenced directly: {{runLog.byId.research-regen.output}}.
const FULL_REF_RE = /^\{\{\s*([\w.\-[\]]+)\s*\}\}$/;
// Built fresh per call (matchAll requires /g; sharing module-scoped /g
// regex state across nested walks is a footgun we just avoid).
function partialRefRe(): RegExp {
  return /\{\{\s*([\w.\-[\]]+)\s*\}\}/g;
}

function lookup(path: string, variables: Record<string, unknown>): unknown {
  const segments = path.split(".");
  let cur: unknown = variables;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function applyTemplate(
  template: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (template == null) return template;
  if (typeof template === "string") {
    const m = template.match(FULL_REF_RE);
    if (m) return lookup(m[1], variables);
    return template.replace(partialRefRe(), (_match, path: string) => {
      const v = lookup(path, variables);
      return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(template)) {
    return template.map((item) => applyTemplate(item, variables));
  }
  if (typeof template === "object") {
    // Drop keys whose value resolves to undefined. This matches zod's
    // optional() semantics — `{ x: "{{ctx.maybe}}" }` with absent
    // ctx.maybe yields `{}`, not `{ x: undefined }`. Critical because
    // Prisma's InputJsonValue rejects undefined; an unfiltered template
    // would explode at AgentJob.create. `null` is preserved (legal JSON).
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      const resolved = applyTemplate(v, variables);
      if (resolved !== undefined) {
        out[k] = resolved;
      }
    }
    return out;
  }
  return template;
}

/**
 * Walk a template and collect every `{{path}}` reference it contains.
 * Used by the binding-editor UI to surface "this template references
 * `ctx.relicID` but the scene's contextSchema only has `ctx.relicId`"
 * before the admin saves a typo.
 */
export function extractReferences(template: unknown): string[] {
  const refs = new Set<string>();
  walk(template, refs);
  return Array.from(refs).sort();
}

function walk(template: unknown, out: Set<string>): void {
  if (typeof template === "string") {
    for (const m of template.matchAll(partialRefRe())) {
      out.add(m[1]);
    }
    return;
  }
  if (Array.isArray(template)) {
    for (const item of template) walk(item, out);
    return;
  }
  if (template && typeof template === "object") {
    for (const v of Object.values(template)) walk(v, out);
  }
}
