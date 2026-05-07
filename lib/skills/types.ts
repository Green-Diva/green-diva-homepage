// Shared types for the skill handler/invoke layer. Imported by
// handlers, registry, invoke, and (later) Backbone/Orchestrator runtimes.

export type SkillHandler = (
  input: unknown,
  config: Record<string, unknown>,
  ctx: HandlerContext,
) => Promise<unknown>;

export type HandlerContext = {
  skillId: string;
  // Future: agentId / jobId / runId / abortSignal
};

export type HandlerErrorCode =
  | "MISSING_ENV"
  | "INVALID_CONFIG"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "OUTPUT_PARSE";

export class HandlerError extends Error {
  readonly code: HandlerErrorCode;
  readonly status?: number;
  constructor(message: string, code: HandlerErrorCode, status?: number) {
    super(message);
    this.name = "HandlerError";
    this.code = code;
    this.status = status;
  }
}
