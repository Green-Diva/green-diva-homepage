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
  // Optional intra-step progress callback for long-running handlers
  // (currently HTTP_API polling). Called best-effort — handler should
  // swallow errors. percent is 0-100 (clamped by consumer); label is a
  // free-form stage string. Caller threads this from the backbone runner
  // so it lands on AgentJob.progressPercent / progressLabel for the
  // frontend to render mid-run. Skills that don't emit (most) cost nothing.
  onProgress?: (snap: { percent?: number; label?: string }) => void | Promise<void>;
  // Resume support for async-task skills. When the handler completes the
  // submit half of a submit-then-poll flow (currently HTTP_API with `polling`),
  // it calls `onSubmitted(initialResponse)` so the caller can persist a
  // resume checkpoint. On a subsequent retry/recovery, the caller supplies
  // `resumeInitialResponse` — the handler skips the POST and proceeds
  // straight into the polling loop using this as the seed response.
  // Both are best-effort; handlers without a submit-then-poll shape ignore them.
  onSubmitted?: (initialResponse: unknown) => void | Promise<void>;
  resumeInitialResponse?: unknown;
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
