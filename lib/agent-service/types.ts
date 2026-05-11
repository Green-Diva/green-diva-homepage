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
import { AgentErrorCode } from "@/lib/agent-errors";

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
  // Authoritative output contract. The agent bound to this scene MUST
  // produce a leaf output that satisfies this schema — typically by
  // adding a tail `transform` JSONata node in BackboneFlowEditor.
  // Enforced both for sync (callScene) and async (runner.ts) invocations;
  // mismatch returns SCENE_OUTPUT_INVALID and (async) marks the AgentJob
  // FAILED before the writeback hook fires.
  outputSchema: TOutput;
  // sync  → callScene awaits the run, returns {ok,output}. Capped by
  //         timeoutMs (default 30s); long jobs should be async.
  // async → dispatchScene returns {jobId} immediately; caller polls the
  //         domain job-status endpoint (e.g. /api/relics/[id]/asset-job/[jobId]).
  invocation: "sync" | "async";
  // Tags used by the binding UI to filter agent candidates. An agent is
  // a candidate iff its declared capabilities ⊇ these.
  requiredCapabilities: string[];
  // Business-level SLA for async scenes. The agent itself may keep
  // running past this window (handler polling can be much longer); the
  // SLA is what the *consumer* (e.g. the Relic detail page) shows the
  // user — exceeding it surfaces as "agent didn't return in time" while
  // a successful late writeback is still honored. No-op for sync scenes.
  slaMs?: number;
  // Async-only override for AgentJob.maxAttempts. Defaults to the schema
  // default (3). Set to 1 for scenes where retrying re-submits an
  // expensive external task (e.g. Meshy) and would just burn quota.
  maxAttempts?: number;
};

// Type-level extractors so callers get full inference from sceneKey.
export type SceneContextOf<S> = S extends SceneDefinition<infer C, z.ZodTypeAny>
  ? z.infer<C>
  : never;
export type SceneOutputOf<S> = S extends SceneDefinition<z.ZodTypeAny, infer O>
  ? z.infer<O>
  : never;

// Discriminated result for sync calls. Both branches carry the AgentJob
// runLog so callers can introspect per-node intermediate outputs (e.g.
// the pipeline's GENERATE_METADATA step inspects runLog when degraded).
// Same shape as AgentJob.runLog (AgentRunLogEntry[]), declared as
// `unknown` here to avoid importing runtime types into the public surface.
export type SceneCallSuccess<T> = {
  ok: true;
  jobId: string;
  output: T;
  runLog: unknown;
};
export type SceneCallFailure = {
  ok: false;
  jobId?: string;
  errorCode: AgentErrorCode;
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
  | typeof AgentErrorCode.UNKNOWN_SCENE        // sceneKey not registered in code
  | typeof AgentErrorCode.UNBOUND_SCENE        // no SceneBinding row exists for this key
  | typeof AgentErrorCode.BINDING_DISABLED     // binding.enabled === false
  | typeof AgentErrorCode.AGENT_MISSING        // binding.agentId points to a deleted agent
  | typeof AgentErrorCode.AGENT_NOT_DEPLOYED   // agent.deployedAt is null
  | typeof AgentErrorCode.CONTEXT_INVALID      // ctx fails contextSchema
  | typeof AgentErrorCode.SCENE_OUTPUT_INVALID // agent leaf output fails outputSchema (sync + async)
  | typeof AgentErrorCode.TEMPLATE_ERROR       // inputMap couldn't be applied
  | typeof AgentErrorCode.TIMEOUT              // sync call exceeded timeoutMs
  | typeof AgentErrorCode.DISPATCH_FAILED;     // catastrophic — usually DB write failed

export class SceneError extends Error {
  // Aligns with AgentRunResult / SkillInvokeResult / API error contract — every
  // discriminated-failure type in the codebase exposes the same field name
  // (`errorCode`) so catch blocks + API responses can be written once. The
  // legacy `code` getter is preserved temporarily for any external caller
  // still reading the old name; remove after 2026-06.
  readonly errorCode: SceneErrorCode;
  readonly httpStatus: number;
  constructor(errorCode: SceneErrorCode, message: string, httpStatus = 500) {
    super(message);
    this.name = "SceneError";
    this.errorCode = errorCode;
    this.httpStatus = httpStatus;
  }
  get code(): SceneErrorCode {
    return this.errorCode;
  }
}

// Convenience alias for stores that hold definitions of unknown shape
// (the registry, the binding UI dropdown, etc).
export type AnySceneDefinition = SceneDefinition<z.ZodTypeAny, z.ZodTypeAny>;
