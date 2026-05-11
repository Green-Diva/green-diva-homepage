// Single-skill invocation entrypoint. Handles input/output JSON Schema
// validation around the actual handler call, normalizes errors into
// a structured InvokeResult so callers (Test Invoke API, Backbone runtime,
// Orchestrator runtime) can render consistent UI without try/catch.
//
// JSON Schema validation here is intentionally minimal (type/required/
// properties/items). It's enough for skill IO contracts in Phase 1;
// switch to ajv when we hit refs/allOf/oneOf in production schemas.

import type { Skill } from "@prisma/client";
import { handlerRegistry } from "./registry";
import { HandlerError } from "./types";
import { AgentErrorCode, logError } from "@/lib/agent-errors";

export type InvokeResult =
  | { ok: true; output: unknown; errors: [] }
  | {
      ok: false;
      output?: unknown;
      errors: string[];
      errorCode:
        | typeof AgentErrorCode.INPUT_SCHEMA_VIOLATION
        | typeof AgentErrorCode.OUTPUT_SCHEMA_VIOLATION
        | typeof AgentErrorCode.INVALID_CONFIG
        | typeof AgentErrorCode.MISSING_ENV
        | typeof AgentErrorCode.HTTP_ERROR
        | typeof AgentErrorCode.TIMEOUT
        | typeof AgentErrorCode.PROVIDER_ERROR
        | typeof AgentErrorCode.OUTPUT_PARSE
        | typeof AgentErrorCode.HANDLER_ERROR;
      schemaErrors?: { input?: string[]; output?: string[] };
    };

function validate(schema: unknown, value: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  return validateAt(schema as Record<string, unknown>, value, "$");
}

function validateAt(schema: Record<string, unknown>, value: unknown, path: string): string[] {
  const errs: string[] = [];
  const t = schema.type as string | string[] | undefined;
  if (t) {
    const types = Array.isArray(t) ? t : [t];
    if (!types.some((tt) => matchType(tt, value))) {
      errs.push(`${path}: expected ${types.join("|")}, got ${actualType(value)}`);
      return errs;
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    const props = (schema.properties as Record<string, unknown> | undefined) ?? {};
    for (const key of required) {
      if (!(key in (value as Record<string, unknown>))) {
        errs.push(`${path}.${key}: required`);
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      const v = (value as Record<string, unknown>)[key];
      if (key in (value as Record<string, unknown>)) {
        errs.push(...validateAt(sub as Record<string, unknown>, v, `${path}.${key}`));
      }
    }
  } else if (Array.isArray(value)) {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) value.forEach((v, i) => errs.push(...validateAt(items, v, `${path}[${i}]`)));
  }
  return errs;
}

function matchType(t: string, v: unknown): boolean {
  if (t === "null") return v === null;
  if (t === "string") return typeof v === "string";
  if (t === "integer") return typeof v === "number" && Number.isInteger(v);
  if (t === "number") return typeof v === "number";
  if (t === "boolean") return typeof v === "boolean";
  if (t === "array") return Array.isArray(v);
  if (t === "object") return typeof v === "object" && v !== null && !Array.isArray(v);
  return true;
}

function actualType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

export async function invokeSkill(skill: Skill, input: unknown): Promise<InvokeResult> {
  const inputErrs = validate(skill.inputSchema, input);
  if (inputErrs.length > 0) {
    return {
      ok: false,
      errors: ["input failed schema validation"],
      errorCode: AgentErrorCode.INPUT_SCHEMA_VIOLATION,
      schemaErrors: { input: inputErrs },
    };
  }

  const handler = handlerRegistry[skill.kind];
  if (!handler) {
    return {
      ok: false,
      errors: [`no handler registered for ${skill.kind}`],
      errorCode: AgentErrorCode.INVALID_CONFIG,
    };
  }

  let output: unknown;
  try {
    const cfg = (skill.handlerConfig ?? {}) as Record<string, unknown>;
    output = await handler(input, cfg, { skillId: skill.id });
  } catch (e) {
    if (e instanceof HandlerError) {
      logError("skill:invoke", e.code, `${skill.id} (${skill.kind}): ${e.message}`);
      return { ok: false, errors: [e.message], errorCode: e.code };
    }
    logError("skill:invoke", AgentErrorCode.HANDLER_ERROR, `${skill.id} unexpected error`, e);
    return { ok: false, errors: ["handler threw"], errorCode: AgentErrorCode.HANDLER_ERROR };
  }

  const outputErrs = validate(skill.outputSchema, output);
  if (outputErrs.length > 0) {
    return {
      ok: false,
      output,
      errors: ["output failed schema validation"],
      errorCode: AgentErrorCode.OUTPUT_SCHEMA_VIOLATION,
      schemaErrors: { output: outputErrs },
    };
  }

  return { ok: true, output, errors: [] };
}
