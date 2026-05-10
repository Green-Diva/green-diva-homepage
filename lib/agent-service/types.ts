// Agent Service — site-wide entry point for "find an agent that satisfies
// this request and run it". See docs in lib/agent-service/README is N/A;
// canonical reference is the architecture section in CLAUDE.md.
//
// Boundary contract:
//   - Modules call callScene / dispatchScene with a sceneKey + ctx.
//   - The scene is registered in code (zod input/output, capability tags).
//   - The agent that satisfies the scene is bound in DB (admin-editable).
//   - Modules NEVER reach into agent / skill / handler — those are the
//     service's private dependencies.

import "server-only";
import type { z } from "zod";
import type { AgentJobStatus } from "@prisma/client";

// Identity attached to every scene invocation. Threaded through to the
// AgentJob row (input._actor) so handlers can enforce per-actor rules
// without pulling the full CurrentUser shape across the boundary.
export type SceneActor = {
  userId: string;
  level: number;
  name: string;
};

// One scene = one capability request the rest of the site can make.
// The DEFINITION (this object) lives in code so type checks bite at
// build time. The IMPLEMENTATION (which agent runs it, how its input is
// built from ctx) lives in DB as a SceneBinding row, edited in
// /agent-control?tab=scenes.
export type SceneDefinition<
  TContext extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  // Globally unique. Convention: "<module>.<verb>" e.g. "relic.enhance2d".
  // Validated at register() against /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.
  key: string;
  // Module label for /agent-control grouping. Conventionally matches the
  // top-level lib/ folder (relic / vault / profile / ...).
  module: string;
  label: { en: string; zh: string };
  description?: { en: string; zh: string };
  // Caller's input shape (validated at the service boundary BEFORE the
  // binding's inputMap is applied).
  contextSchema: TContext;
  // Caller's expected output shape. Enforced for sync invocations; for
  // async invocations it's advisory — used by the binding UI to validate
  // outputMap and by /api/agent-jobs/[jobId] to shape the response.
  outputSchema: TOutput;
  // sync  → callScene awaits the run, returns {ok,output}. Capped by
  //         timeoutMs (default 30s); long jobs should be async.
  // async → dispatchScene returns {jobId} immediately; caller polls
  //         /api/agent-jobs/[jobId].
  invocation: "sync" | "async";
  // Tags used by the binding UI to filter agent candidates. An agent is
  // a candidate iff its declared capabilities ⊇ these.
  requiredCapabilities: string[];
};

// Type-level extractors so callers get full inference from sceneKey.
export type SceneContextOf<S> = S extends SceneDefinition<infer C, z.ZodTypeAny>
  ? z.infer<C>
  : never;
export type SceneOutputOf<S> = S extends SceneDefinition<z.ZodTypeAny, infer O>
  ? z.infer<O>
  : never;

// Discriminated result for sync calls. Both branches carry the AgentJob
// runLog — sync callers often need to pull per-node output (e.g. the
// pipeline's GENERATE_METADATA step reads research.output / pick.output
// out of the runLog). Same shape as AgentJob.runLog (AgentRunLogEntry[]),
// declared as `unknown` here to avoid importing runtime types into the
// public surface.
export type SceneCallSuccess<T> = {
  ok: true;
  jobId: string;
  output: T;
  runLog: unknown;
};
export type SceneCallFailure = {
  ok: false;
  jobId?: string;
  errorCode: string;
  errorMessage: string;
  runLog?: unknown;
};
export type SceneCallResult<T> = SceneCallSuccess<T> | SceneCallFailure;

// Async dispatch never blocks on agent execution — caller polls separately.
export type SceneDispatchResult = {
  jobId: string;
  agentId: string;
  status: AgentJobStatus;
  createdAt: Date;
};

// Service-level errors are thrown only for MISUSE (unknown scene, missing
// binding, schema violation, template explosion). Runtime failures inside
// the agent come back as SceneCallFailure / FAILED AgentJob so callers
// can branch on them.
export type SceneErrorCode =
  | "UNKNOWN_SCENE"        // sceneKey not registered in code
  | "UNBOUND_SCENE"        // no SceneBinding row exists for this key
  | "BINDING_DISABLED"     // binding.enabled === false
  | "AGENT_MISSING"        // binding.agentId points to a deleted agent
  | "AGENT_NOT_DEPLOYED"   // agent.deployedAt is null
  | "CONTEXT_INVALID"      // ctx fails contextSchema
  | "OUTPUT_INVALID"       // agent output fails outputSchema (sync only)
  | "TEMPLATE_ERROR"       // inputMap / outputMap couldn't be applied
  | "TIMEOUT"              // sync call exceeded timeoutMs
  | "DISPATCH_FAILED";     // catastrophic — usually DB write failed

export class SceneError extends Error {
  readonly code: SceneErrorCode;
  readonly httpStatus: number;
  constructor(code: SceneErrorCode, message: string, httpStatus = 500) {
    super(message);
    this.name = "SceneError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// Convenience alias for stores that hold definitions of unknown shape
// (the registry, the binding UI dropdown, etc).
export type AnySceneDefinition = SceneDefinition<z.ZodTypeAny, z.ZodTypeAny>;
