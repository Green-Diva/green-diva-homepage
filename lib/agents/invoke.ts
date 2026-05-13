import "server-only";
import type { Agent, AgentMode } from "@prisma/client";
import { runBackbone } from "@/lib/skills/runtime/backbone";
import { runOrchestrator } from "@/lib/skills/runtime/orchestrator";
import type { AgentErrorCode } from "@/lib/agent-errors";

// Per-step record appended by Backbone (Phase 3) and Orchestrator (Phase 4)
// runtimes. Phase 2 leaves runLog empty since the actual execution layer
// returns failure before any step runs.
export type AgentRunLogEntry = {
  stepId: string;
  skillId?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  ok: boolean;
  output?: unknown;
  errorCode?: AgentErrorCode;
  errorMessage?: string;
  // DAG (v2) extras:
  // - `skipped`: node was unreachable (no live incoming edge) on this run,
  //   e.g. the 3D path on a 2D-classified item. Skipped entries are `ok:true`.
  // - `branchLabel`: the case label a branch node chose; in the trace UI this
  //   identifies which outgoing edge became live.
  skipped?: boolean;
  branchLabel?: string;
};

export type AgentRunSuccess = {
  ok: true;
  output: unknown;
  runLog: AgentRunLogEntry[];
};

export type AgentRunFailure = {
  ok: false;
  errorCode: AgentErrorCode;
  errorMessage: string;
  runLog: AgentRunLogEntry[];
};

// Discriminated union: failures still carry runLog so callers can show
// the user "step 2 hit 503" instead of just "FAILED". Catastrophic errors
// that prevent the runtime from starting at all (DB unreachable, agent
// missing) are still thrown by upstream code.
export type AgentRunResult = AgentRunSuccess | AgentRunFailure;

export class AgentRuntimeError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AgentRuntimeError";
    this.code = code;
  }
}

// Mode-dispatcher. Routes to mode-specific runtimes; never throws for
// "execution failed" cases — those return AgentRunFailure so runLog
// flows through to the AgentJob row. Only invalid mode throws.
//
// Naming: `executeAgent` is the canonical name as of 2026-05-11. Previously
// called `invokeAgent`, which created 3-way overloading with the lower-level
// `invokeSkill` (handler call) and orchestrator-internal `invokeTool` (LLM
// tool dispatch). The export alias `invokeAgent` is preserved for callers
// that haven't migrated yet; remove after 2026-06.
export async function executeAgent(opts: {
  agent: Agent;
  mode: AgentMode;
  input: unknown;
  // Optional overrides for dry-run: editor's unsaved configs.
  // When absent, runtime reads the corresponding column from DB.
  pipelineConfigOverride?: unknown;
  dispatcherConfigOverride?: unknown;
  // Streaming hook (MECHANICAL only): fires after each backbone node
  // settles, lets the caller persist intermediate progress so long-running
  // skills (e.g. 30s Gemini call) don't keep the UI stuck on one number.
  onProgress?: (info: { runLog: AgentRunLogEntry[] }) => void | Promise<void>;
  // Intra-step progress hook (MECHANICAL only, HTTP_API polling). Fires
  // inside a single skill node (e.g. Meshy's 3-min image-to-3D poll loop).
  // Runner uses this to write AgentJob.progressPercent / progressLabel
  // so the frontend can render a mid-run % bar instead of an indefinite
  // spinner. AUTONOMOUS path doesn't wire this yet — orchestrator's
  // invokeSkill call site would need the same opts.onProgress threading.
  onSkillProgress?: (snap: { percent?: number; label?: string }) => void | Promise<void>;
  // Resume-checkpoint plumbing (MECHANICAL only). `onSkillSubmitted` fires
  // after a submit-then-poll skill's POST half completes so the runner can
  // persist taskId-bearing initialResponse; `resumeBySkillStepId` lets the
  // runner replay a previously persisted submit on crash recovery (skill
  // executor matches by prefixed stepId, skips POST, jumps into polling).
  // AUTONOMOUS path doesn't carry checkpoints — orchestrator's tool-use
  // loop doesn't have a stable per-step identity to key against.
  onSkillSubmitted?: (info: {
    stepId: string;
    skillId: string;
    skillSlug: string;
    initialResponse: unknown;
  }) => void | Promise<void>;
  resumeBySkillStepId?: Map<string, unknown>;
}): Promise<AgentRunResult> {
  if (opts.mode === "MECHANICAL") {
    return runBackbone({
      agentId: opts.agent.id,
      input: opts.input,
      pipelineConfig: opts.pipelineConfigOverride ?? opts.agent.pipelineConfig,
      onProgress: opts.onProgress,
      onSkillProgress: opts.onSkillProgress,
      onSkillSubmitted: opts.onSkillSubmitted,
      resumeBySkillStepId: opts.resumeBySkillStepId,
    });
  }
  if (opts.mode === "AUTONOMOUS") {
    return runOrchestrator({
      agentId: opts.agent.id,
      input: opts.input,
      dispatcherConfig: opts.dispatcherConfigOverride ?? opts.agent.dispatcherConfig,
    });
  }
  throw new AgentRuntimeError(`unknown agent mode: ${opts.mode}`, "INVALID_MODE");
}

/** @deprecated Use `executeAgent` instead. Removed after 2026-06. */
export const invokeAgent = executeAgent;
