// `{{path}}` template engine + parser. Two roles:
//
//   1. applyTemplate — runtime interpolation. Used by skill handlers
//      (httpApi / llmPrompt) to resolve `{{input.X}}` style refs inside
//      Skill.handlerConfig (request bodies, URLs, prompts, polling URLs,
//      responseTransform). Caller picks the variables namespace
//      (conventionally `{ input }` for skills, formerly `{ ctx, actor }`
//      for SceneBinding.inputMap before that field was retired
//      2026-05-12).
//
//   2. parseTemplate — strict save-time validator. Used by zod refines
//      on Skill.handlerConfig to surface malformed `{{...}}` blobs
//      before they reach runtime.
//
// Syntax — single placeholder per cell: `{{path.to.value}}`.
//   - Whole-string match → returns the raw looked-up value (preserves
//     number / object / array type). Use this for non-string fields.
//   - Embedded match → string interpolation; non-string values are
//     JSON.stringified.
//
// Missing paths resolve to undefined (whole-value) or empty string
// (interpolated); they DO NOT throw — downstream zod schema validation
// gives a much better error pointing at which field broke.
//
// SceneBinding.inputMap is the historical primary caller and was retired
// 2026-05-12. ctx → agent.input is now owned by scene.prepareAgentInput
// in code. `extractReferences` (the inputMap-editor helper) went with
// it; only applyTemplate + parseTemplate remain.

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
    // Drop keys whose value resolves to undefined. Matches zod's
    // optional() semantics — `{ x: "{{maybe}}" }` with absent
    // maybe yields `{}`, not `{ x: undefined }`. Critical because
    // Prisma's InputJsonValue rejects undefined. `null` is preserved.
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

// Strict path syntax — same char class as partialRefRe.
const VALID_PATH_RE = /^[\w.\-[\]]+$/;

export type TemplateParseResult =
  | { ok: true; refs: string[] }
  | { ok: false; error: string; offset: number };

/**
 * Strict parse-once validator for `{{path}}` templates. Used by zod
 * refines on Skill.handlerConfig + SceneBinding.inputMap to surface
 * config errors at save-time instead of at runtime ("configuration as
 * compile") — same pattern JSONata `transform` nodes follow in
 * lib/skills/runtime/backbone.ts.
 *
 * Rules:
 *   - Every `{{` must have a matching `}}` later in the string.
 *   - Reference body, after trim, must be non-empty and match
 *     [\w.\-[\]]+ (word chars + dot + dash + brackets).
 *   - A stray `}}` without a preceding `{{` is allowed (literal text;
 *     applyTemplate also treats it as text). Only `{{...}}` opens a
 *     reference scope.
 */
export function parseTemplate(input: string): TemplateParseResult {
  const refs: string[] = [];
  let i = 0;
  while (i < input.length) {
    const open = input.indexOf("{{", i);
    if (open === -1) break;
    const close = input.indexOf("}}", open + 2);
    if (close === -1) {
      return { ok: false, error: "unterminated reference", offset: open };
    }
    const raw = input.slice(open + 2, close);
    const path = raw.trim();
    if (!path) {
      return { ok: false, error: 'invalid path ""', offset: open };
    }
    if (!VALID_PATH_RE.test(path)) {
      return { ok: false, error: `invalid path "${path}"`, offset: open };
    }
    refs.push(path);
    i = close + 2;
  }
  return { ok: true, refs };
}
