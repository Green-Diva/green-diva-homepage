// AgentJob async runner. Pattern mirrors lib/relics/pipeline/runner.ts:
// - Fire-and-forget from API route: `void runAgentJob(jobId)`
// - Top-level try/catch never throws (errors land in DB as FAILED rows)
// - Status transitions: PENDING → RUNNING → SUCCESS|FAILED
// - Transient errors (5xx / timeout / ECONN / EAI_AGAIN / "fetch failed")
//   retry with exponential backoff up to AgentJob.maxAttempts
// - Crash recovery: lib/server-init.ts re-fires RUNNING jobs older than 10min
//
// invokeAgent returns AgentRunResult (discriminated union). Failures still
// carry runLog so the user can see which step blew up.

import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invokeAgent, type AgentRunResult } from "@/lib/agents/invoke";

const TRANSIENT_PATTERNS = [
  /\b5\d\d\b/, // 5xx HTTP status anywhere in message
  /timeout/i,
  /ECONN/i,
  /EAI_AGAIN/i,
  /fetch failed/i,
];

function isTransient(message: string): boolean {
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

function backoffMs(attemptsSoFar: number): number {
  // attemptsSoFar=1 → 2s, 2 → 4s, 3 → 8s, capped 30s.
  return Math.min(2 ** attemptsSoFar * 1000, 30_000);
}

function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v === undefined || v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
}

export async function runAgentJob(jobId: string): Promise<void> {
  try {
    const job = await prisma.agentJob.findUnique({
      where: { id: jobId },
      include: { agent: true },
    });
    if (!job) {
      console.error(`[agent-job:run] ${jobId} not found`);
      return;
    }
    if (job.status === "SUCCESS" || job.status === "FAILED") {
      // Idempotent: don't re-run terminal jobs.
      return;
    }

    await prisma.agentJob.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        startedAt: job.startedAt ?? new Date(),
        attempts: { increment: 1 },
        errorCode: null,
        errorMessage: null,
      },
    });

    let result: AgentRunResult;
    try {
      result = await invokeAgent({
        agent: job.agent,
        mode: job.mode,
        input: job.input,
      });
    } catch (e) {
      // Catastrophic — dispatcher itself threw (invalid mode, prisma down).
      // No runLog to preserve. Mark FAILED unconditionally.
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[agent-job:run] ${jobId} dispatcher threw:`, message);
      await prisma.agentJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorCode: "AGENT_RUNTIME_ERROR",
          errorMessage: message.slice(0, 1000),
          endedAt: new Date(),
        },
      });
      return;
    }

    if (result.ok) {
      await prisma.agentJob.update({
        where: { id: jobId },
        data: {
          status: "SUCCESS",
          output: jsonOrNull(result.output),
          runLog: result.runLog as unknown as Prisma.InputJsonValue,
          endedAt: new Date(),
        },
      });
      // Per-mode writeback to Relic. Triggered for relic-bound agent calls
      // ({ mode: "2dEnhance" | "3dCreate", _relicId, ... }) — pure agent
      // invocations without `_relicId` are unaffected.
      try {
        await maybeWriteRelicAsset(job.input, result.output);
      } catch (e) {
        console.error(`[agent-job:run] ${jobId} relic writeback failed:`, e);
      }
      return;
    }

    // result.ok === false — preserve runLog, decide retry based on errorMessage.
    const message = result.errorMessage;
    const code = result.errorCode;
    console.error(`[agent-job:run] ${jobId} (${code}):`, message);

    const fresh = await prisma.agentJob.findUnique({
      where: { id: jobId },
      select: { attempts: true, maxAttempts: true },
    });
    const canRetry = !!fresh && isTransient(message) && fresh.attempts < fresh.maxAttempts;
    if (canRetry) {
      await prisma.agentJob.update({
        where: { id: jobId },
        data: {
          status: "PENDING",
          errorCode: code,
          errorMessage: `transient (will retry): ${message.slice(0, 500)}`,
          // Persist runLog from this attempt so the user can see what already ran.
          runLog: result.runLog as unknown as Prisma.InputJsonValue,
        },
      });
      const delay = backoffMs(fresh.attempts);
      setTimeout(() => {
        void runAgentJob(jobId);
      }, delay);
      return;
    }

    await prisma.agentJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorCode: code,
        errorMessage: message.slice(0, 1000),
        runLog: result.runLog as unknown as Prisma.InputJsonValue,
        endedAt: new Date(),
      },
    });
  } catch (e) {
    // Catastrophic — couldn't even mark FAILED. One last attempt to record it.
    console.error(`[agent-job:run] ${jobId} catastrophic top-level error`, e);
    try {
      await prisma.agentJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorCode: "RUNNER_CRASH",
          errorMessage: e instanceof Error ? e.message.slice(0, 500) : "runner crashed",
          endedAt: new Date(),
        },
      });
    } catch {
      // give up — DB itself is unhappy
    }
  }
}

// — Relic writeback hook — — — — — — — — — — — — — — — — — — — — — — —
//
// Runner-level writeback: when a relic-bound agent invocation succeeds
// (input contains `_relicId` + a known mode), copy the relevant fields
// from the agent's leaf output into the Relic row. Unknown modes / inputs
// without `_relicId` are no-ops, so general agent invocations are unaffected.
//
// Idempotent: re-running the same input writes the same fields. Safe to
// trigger multiple times (e.g. via retry).

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function maybeWriteRelicAsset(
  rawInput: unknown,
  rawOutput: unknown,
): Promise<void> {
  if (!isObject(rawInput)) return;
  const relicId = typeof rawInput._relicId === "string" ? rawInput._relicId : null;
  const mode = typeof rawInput.mode === "string" ? rawInput.mode : null;
  if (!relicId || !mode) return;

  if (mode === "2dEnhance") {
    if (!isObject(rawOutput)) return;
    const enhancedImagePath =
      typeof rawOutput.enhancedImagePath === "string" ? rawOutput.enhancedImagePath : null;
    if (!enhancedImagePath) return;
    await prisma.relic.update({
      where: { id: relicId },
      data: { enhancedImagePath },
    });
    return;
  }

  if (mode === "3dCreate") {
    if (!isObject(rawOutput)) return;
    const modelPath =
      typeof rawOutput.modelPath === "string" ? rawOutput.modelPath : null;
    if (!modelPath) return;
    await prisma.relic.update({
      where: { id: relicId },
      data: { modelPath },
    });
    return;
  }

  // initial / regenMetadata don't go through this runner — they're called
  // synchronously from the pipeline step / regen endpoint and write back
  // from the caller's context.
}
