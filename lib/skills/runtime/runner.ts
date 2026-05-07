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
