// callScene / dispatchScene — the only entry points the rest of the site
// uses to invoke an agent. Modules NEVER reach into agent / skill /
// handler directly; they go through these.
//
// Lifecycle for both functions:
//   1. registry.requireScene(key) — definition exists in code?
//   2. scene.contextSchema.safeParse(ctx) — caller's input shape OK?
//   3. SceneBinding row exists & enabled?
//   4. agent exists & deployed?
//   5. applyTemplate(binding.inputMap, {ctx, actor}) → agentInput
//   6a. dispatchScene: prisma.agentJob.create + void runAgentJob → {jobId}
//   6b. callScene: invokeAgent inline (timeout-bounded) →
//                  apply binding.outputMap → outputSchema validate → result

import "server-only";
import { Prisma, type AgentJobStatus, type AgentMode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureServerInit } from "@/lib/server-init";
import { runAgentJob } from "@/lib/skills/runtime/runner";
import { invokeAgent, type AgentRunLogEntry } from "@/lib/agents/invoke";
import { requireScene } from "./registry";
import { applyTemplate } from "./template";
import {
  SceneError,
  type AnySceneDefinition,
  type SceneActor,
  type SceneCallResult,
  type SceneDispatchResult,
} from "./types";

const DEFAULT_SYNC_TIMEOUT_MS = 30_000;

// undefined → JsonNull. Prisma rejects bare undefined for Json columns.
function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v === undefined || v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
}

type ResolvedBinding = {
  scene: AnySceneDefinition;
  agent: { id: string; codename: string; mode: AgentMode; deployedAt: Date | null };
  inputMap: unknown;
  outputMap: unknown;
  agentInput: unknown;
  ctxResolved: unknown;
  actor: SceneActor | null;
};

async function resolveBinding(
  sceneKey: string,
  ctx: unknown,
  actor: SceneActor | null,
): Promise<ResolvedBinding> {
  const scene = requireScene(sceneKey);

  const ctxResult = scene.contextSchema.safeParse(ctx);
  if (!ctxResult.success) {
    const detail = ctxResult.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new SceneError(
      "CONTEXT_INVALID",
      `scene "${sceneKey}" context invalid: ${detail}`,
      400,
    );
  }

  const binding = await prisma.sceneBinding.findUnique({ where: { sceneKey } });
  if (!binding) {
    throw new SceneError(
      "UNBOUND_SCENE",
      `scene "${sceneKey}" has no SceneBinding — admin must bind it in /agent-control?tab=scenes`,
      503,
    );
  }
  if (!binding.enabled) {
    throw new SceneError("BINDING_DISABLED", `scene "${sceneKey}" binding is disabled`, 503);
  }

  const agent = await prisma.agent.findUnique({
    where: { id: binding.agentId },
    select: { id: true, codename: true, mode: true, deployedAt: true },
  });
  if (!agent) {
    throw new SceneError(
      "AGENT_MISSING",
      `scene "${sceneKey}" binding points to agentId "${binding.agentId}" which no longer exists`,
      503,
    );
  }
  if (!agent.deployedAt) {
    throw new SceneError(
      "AGENT_NOT_DEPLOYED",
      `scene "${sceneKey}" agent "${agent.codename}" is not deployed`,
      503,
    );
  }

  let agentInput: unknown;
  try {
    agentInput = applyTemplate(binding.inputMap, {
      ctx: ctxResult.data,
      actor,
    } as Record<string, unknown>);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new SceneError(
      "TEMPLATE_ERROR",
      `scene "${sceneKey}" inputMap apply failed: ${message}`,
      500,
    );
  }

  return {
    scene,
    agent,
    inputMap: binding.inputMap,
    outputMap: binding.outputMap,
    agentInput,
    ctxResolved: ctxResult.data,
    actor,
  };
}

/**
 * Async dispatch — write an AgentJob, fire-and-forget the runner, return
 * `{ jobId }` immediately. The caller polls /api/agent-jobs/[jobId] for
 * progress / output.
 *
 * Use for any scene whose underlying work takes more than a few seconds
 * (image cutout, 3D generation, multi-step LLM chains, ...).
 */
export async function dispatchScene(
  sceneKey: string,
  ctx: unknown,
  opts?: { actor?: SceneActor | null },
): Promise<SceneDispatchResult> {
  await ensureServerInit();

  const actor = opts?.actor ?? null;
  const resolved = await resolveBinding(sceneKey, ctx, actor);

  let job;
  try {
    job = await prisma.agentJob.create({
      data: {
        agentId: resolved.agent.id,
        mode: resolved.agent.mode,
        input: jsonOrNull(resolved.agentInput),
        status: "PENDING",
      },
      select: { id: true, status: true, createdAt: true },
    });
  } catch (e) {
    console.error(`[scene:dispatch] ${sceneKey} create job failed`, e);
    throw new SceneError("DISPATCH_FAILED", `failed to enqueue scene "${sceneKey}"`, 500);
  }

  void runAgentJob(job.id);

  return {
    jobId: job.id,
    agentId: resolved.agent.id,
    status: job.status as AgentJobStatus,
    createdAt: job.createdAt,
  };
}

/**
 * Sync call — invoke the agent inline within `timeoutMs` (default 30s).
 * Long-running scenes should use dispatchScene + polling instead.
 *
 * An AgentJob row is still written so /agent-control's history view
 * captures sync invocations alongside async ones.
 */
export async function callScene<T = unknown>(
  sceneKey: string,
  ctx: unknown,
  opts?: {
    actor?: SceneActor | null;
    timeoutMs?: number;
    // Progress hook fired after each backbone node settles. Only meaningful
    // for MECHANICAL agents; AUTONOMOUS dispatcher doesn't stream node
    // checkpoints. Used by the relic draft pipeline to persist intermediate
    // runLog so the UI can show "research running" instead of stuck at 50%.
    onProgress?: (info: { runLog: AgentRunLogEntry[] }) => void | Promise<void>;
  },
): Promise<SceneCallResult<T>> {
  await ensureServerInit();

  const actor = opts?.actor ?? null;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
  const resolved = await resolveBinding(sceneKey, ctx, actor);

  let job;
  try {
    job = await prisma.agentJob.create({
      data: {
        agentId: resolved.agent.id,
        mode: resolved.agent.mode,
        input: jsonOrNull(resolved.agentInput),
        status: "RUNNING",
        startedAt: new Date(),
        attempts: 1,
      },
      select: { id: true },
    });
  } catch (e) {
    console.error(`[scene:call] ${sceneKey} create job failed`, e);
    throw new SceneError("DISPATCH_FAILED", `failed to enqueue scene "${sceneKey}"`, 500);
  }

  // invokeAgent reads pipelineConfig / dispatcherConfig — need full row.
  const fullAgent = await prisma.agent.findUnique({ where: { id: resolved.agent.id } });
  if (!fullAgent) {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorCode: "AGENT_MISSING",
        errorMessage: "agent vanished between binding and call",
        endedAt: new Date(),
      },
    });
    return {
      ok: false,
      jobId: job.id,
      errorCode: "AGENT_MISSING",
      errorMessage: `agent "${resolved.agent.codename}" vanished between binding and call`,
    };
  }

  // Race the agent invocation against the timeout. If timeout wins, the
  // invocation keeps running in the background — its result is discarded
  // (caller has already received TIMEOUT). This wastes a few cents of LLM
  // tokens in the worst case but avoids hanging the request.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ __timeout: true }>((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
  });
  const raced = await Promise.race([
    invokeAgent({
      agent: fullAgent,
      mode: resolved.agent.mode,
      input: resolved.agentInput,
      onProgress: opts?.onProgress,
    }),
    timeoutPromise,
  ]);
  if (timer) clearTimeout(timer);

  if ("__timeout" in raced) {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorCode: "TIMEOUT",
        errorMessage: `sync call exceeded ${timeoutMs}ms`,
        endedAt: new Date(),
      },
    });
    return {
      ok: false,
      jobId: job.id,
      errorCode: "TIMEOUT",
      errorMessage: `scene "${sceneKey}" exceeded ${timeoutMs}ms — consider switching to dispatchScene`,
    };
  }

  if (!raced.ok) {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorCode: raced.errorCode,
        errorMessage: raced.errorMessage.slice(0, 1000),
        runLog: raced.runLog as unknown as Prisma.InputJsonValue,
        endedAt: new Date(),
      },
    });
    return {
      ok: false,
      jobId: job.id,
      errorCode: raced.errorCode,
      errorMessage: raced.errorMessage,
      runLog: raced.runLog,
    };
  }

  // Optional outputMap rewriting before schema validation. Lets admin
  // reshape agent output without changing the agent itself. The template
  // scope exposes:
  //   - output       : the agent's leaf output (mode-router last node)
  //   - runLog       : full runLog array
  //   - runLog.byId  : keyed by node id for direct {{runLog.byId.<id>.output}}
  //                    lookups — saves callers from indexing by position
  //   - ctx, actor   : the original scene call's caller context / identity
  const runLogArr = Array.isArray(raced.runLog) ? raced.runLog : [];
  const byId: Record<string, unknown> = {};
  for (const entry of runLogArr) {
    if (entry && typeof entry === "object" && "stepId" in entry) {
      const e = entry as Record<string, unknown>;
      const id = typeof e.stepId === "string" ? e.stepId : null;
      if (id) byId[id] = e;
    }
  }
  let mappedOutput: unknown = raced.output;
  if (resolved.outputMap !== null && resolved.outputMap !== undefined) {
    try {
      mappedOutput = applyTemplate(resolved.outputMap, {
        output: raced.output,
        runLog: { entries: runLogArr, byId },
        ctx: resolved.ctxResolved,
        actor: resolved.actor,
      } as Record<string, unknown>);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.agentJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorCode: "TEMPLATE_ERROR",
          errorMessage: message.slice(0, 1000),
          output: jsonOrNull(raced.output),
          runLog: raced.runLog as unknown as Prisma.InputJsonValue,
          endedAt: new Date(),
        },
      });
      return {
        ok: false,
        jobId: job.id,
        errorCode: "TEMPLATE_ERROR",
        errorMessage: `outputMap failed: ${message}`,
        runLog: raced.runLog,
      };
    }
  }

  const outResult = resolved.scene.outputSchema.safeParse(mappedOutput);
  if (!outResult.success) {
    const detail = outResult.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorCode: "OUTPUT_INVALID",
        errorMessage: detail.slice(0, 1000),
        output: jsonOrNull(mappedOutput),
        runLog: raced.runLog as unknown as Prisma.InputJsonValue,
        endedAt: new Date(),
      },
    });
    return {
      ok: false,
      jobId: job.id,
      errorCode: "OUTPUT_INVALID",
      errorMessage: `agent output didn't match scene outputSchema: ${detail}`,
      runLog: raced.runLog,
    };
  }

  await prisma.agentJob.update({
    where: { id: job.id },
    data: {
      status: "SUCCESS",
      output: jsonOrNull(outResult.data),
      runLog: raced.runLog as unknown as Prisma.InputJsonValue,
      endedAt: new Date(),
    },
  });

  return {
    ok: true,
    jobId: job.id,
    output: outResult.data as T,
    runLog: raced.runLog,
  };
}
