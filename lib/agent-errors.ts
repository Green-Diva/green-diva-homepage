// Single source of truth for agent-runtime error codes.
//
// All raw "AGENT_*" / "PIPELINE_*" / "HTTP_ERROR" / etc. string literals
// scattered across backbone / orchestrator / runner / handlers / scene
// dispatch / api-error live here as a typed enum so:
//   - failure result types (`AgentRunResult.errorCode`,
//     `SkillInvokeResult.errorCode`, `SceneError.errorCode`,
//     `respondError(code, ...)`) can be narrowed from `string` to
//     `AgentErrorCode`, letting tsc catch typos and stale codes.
//   - UI (AgentJobDrawer) can switch on a closed union to render
//     diagnostic hints — see lib/agent-errors-i18n.ts.
//   - logs share a grep-friendly `[source:CODE] message` prefix via
//     `logError(source, code, message, data?)`.
//
// File is client-safe (no `server-only`) — both runtime and UI import it.
//
// Per CLAUDE.md, these names are grandfathered and intentionally don't
// follow <DOMAIN>_<STATE>: TIMEOUT, INPUT_SCHEMA_VIOLATION,
// OUTPUT_SCHEMA_VIOLATION, HANDLER_ERROR, PROVIDER_ERROR. Don't rename.

export const AgentErrorCode = {
  // Pipeline / Dispatcher config layer
  PIPELINE_MISSING: "PIPELINE_MISSING",
  PIPELINE_INVALID: "PIPELINE_INVALID",
  PIPELINE_VERSION: "PIPELINE_VERSION",
  PIPELINE_DEAD_END: "PIPELINE_DEAD_END",
  DISPATCHER_MISSING: "DISPATCHER_MISSING",
  DISPATCHER_INVALID: "DISPATCHER_INVALID",
  DISPATCHER_VERSION: "DISPATCHER_VERSION",

  // DAG execution layer
  SLOT_EMPTY: "SLOT_EMPTY",
  SKILL_OFFLINE: "SKILL_OFFLINE",
  BRANCH_NO_MATCH: "BRANCH_NO_MATCH",
  BRANCH_NO_EDGE: "BRANCH_NO_EDGE",
  LOOP_TOO_DEEP: "LOOP_TOO_DEEP",
  FOREACH_INPUT_NOT_ARRAY: "FOREACH_INPUT_NOT_ARRAY",
  TRANSFORM_FAILED: "TRANSFORM_FAILED",

  // Orchestrator layer
  NO_TOOLS: "NO_TOOLS",
  UNKNOWN_TOOL: "UNKNOWN_TOOL",

  // Handler layer (grandfathered names)
  MISSING_ENV: "MISSING_ENV",
  INVALID_CONFIG: "INVALID_CONFIG",
  HTTP_ERROR: "HTTP_ERROR",
  TIMEOUT: "TIMEOUT",
  OUTPUT_PARSE: "OUTPUT_PARSE",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  HANDLER_ERROR: "HANDLER_ERROR",

  // Skill invoke layer (grandfathered)
  INPUT_SCHEMA_VIOLATION: "INPUT_SCHEMA_VIOLATION",
  OUTPUT_SCHEMA_VIOLATION: "OUTPUT_SCHEMA_VIOLATION",

  // Runner / scene dispatch layer
  AGENT_RUNTIME_ERROR: "AGENT_RUNTIME_ERROR",
  SCENE_OUTPUT_INVALID: "SCENE_OUTPUT_INVALID",
  RUNNER_CRASH: "RUNNER_CRASH",
  UNKNOWN_SCENE: "UNKNOWN_SCENE",
  UNBOUND_SCENE: "UNBOUND_SCENE",
  BINDING_DISABLED: "BINDING_DISABLED",
  AGENT_MISSING: "AGENT_MISSING",
  AGENT_NOT_DEPLOYED: "AGENT_NOT_DEPLOYED",
  CONTEXT_INVALID: "CONTEXT_INVALID",
  TEMPLATE_ERROR: "TEMPLATE_ERROR",
  DISPATCH_FAILED: "DISPATCH_FAILED",

  // API HTTP boundary
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_FORBIDDEN: "AUTH_FORBIDDEN",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",

  // API CRUD action failures (raised when prisma op throws unexpectedly).
  // Specific to API surface; runtime layer never uses these.
  CREATE_FAILED: "CREATE_FAILED",
  UPDATE_FAILED: "UPDATE_FAILED",
  DELETE_FAILED: "DELETE_FAILED",
  SAVE_FAILED: "SAVE_FAILED",
  DEPLOY_FAILED: "DEPLOY_FAILED",
  INVOKE_FAILED: "INVOKE_FAILED",
  IMPORT_FAILED: "IMPORT_FAILED",
  RETRY_FAILED: "RETRY_FAILED",
  EQUIP_FAILED: "EQUIP_FAILED",
  UNEQUIP_FAILED: "UNEQUIP_FAILED",
  WRITE_FAILED: "WRITE_FAILED",

  // API domain rules
  EQUIP_CAPACITY_EXCEEDED: "EQUIP_CAPACITY_EXCEEDED",
  SKILL_SLUG_CONFLICT: "SKILL_SLUG_CONFLICT",
  NO_FIELDS_TO_UPDATE: "NO_FIELDS_TO_UPDATE",
  JOB_NOT_RETRYABLE: "JOB_NOT_RETRYABLE",
  JOB_IN_FLIGHT: "JOB_IN_FLIGHT",
  BINDING_AGENT_MISSING: "BINDING_AGENT_MISSING",
  BINDING_AGENT_NOT_DEPLOYED: "BINDING_AGENT_NOT_DEPLOYED",

  // API request-body validation
  INVALID_JSON: "INVALID_JSON",
  INVALID_FORM: "INVALID_FORM",
  MISSING_FILE: "MISSING_FILE",
  BASE64_INVALID: "BASE64_INVALID",
  BUFFER_EMPTY: "BUFFER_EMPTY",
  PATH_TRAVERSAL_BLOCKED: "PATH_TRAVERSAL_BLOCKED",
} as const;

export type AgentErrorCode = (typeof AgentErrorCode)[keyof typeof AgentErrorCode];

export type LogSource =
  | "backbone"
  | "orchestrator"
  | "runner"
  | "skill:invoke"
  | "handler:http"
  | "handler:llm"
  | "handler:mcp"
  | "scene-registry"
  | "scene-dispatch"
  | "agent-job:run"
  | "api";

export function fmtLog(source: LogSource, code: AgentErrorCode, message: string): string {
  return `[${source}:${code}] ${message}`;
}

export function logError(
  source: LogSource,
  code: AgentErrorCode,
  message: string,
  data?: unknown,
): void {
  if (data === undefined) {
    console.error(fmtLog(source, code, message));
  } else {
    console.error(fmtLog(source, code, message), data);
  }
}
