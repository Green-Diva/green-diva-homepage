// Shared types for the skill handler/invoke layer. Imported by
// handlers, registry, invoke, and (later) Backbone/Orchestrator runtimes.

import { AgentErrorCode } from "@/lib/agent-errors";

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
  | typeof AgentErrorCode.MISSING_ENV
  | typeof AgentErrorCode.INVALID_CONFIG
  | typeof AgentErrorCode.HTTP_ERROR
  | typeof AgentErrorCode.TIMEOUT
  | typeof AgentErrorCode.PROVIDER_ERROR
  | typeof AgentErrorCode.OUTPUT_PARSE;

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
