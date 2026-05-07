import "server-only";
import { prisma } from "@/lib/db";
import { runRelicPipeline } from "@/lib/relics/pipeline";
import { runAgentJob } from "@/lib/skills/runtime/runner";

const STALE_MS = 10 * 60 * 1000;

let initPromise: Promise<void> | null = null;

/**
 * Lazy server-side init. Call from API route handlers that create/touch
 * async jobs (relic pipeline + agent invocations). Idempotent: subsequent
 * calls resolve immediately from the memoised promise.
 *
 * Resumes jobs left in RUNNING state by a previous process (server restart /
 * crash). Anything updated more than 10 minutes ago is considered abandoned
 * and re-fired on a fresh attempt.
 */
export function ensureServerInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init().catch((e) => {
      console.error("[server-init] failed", e);
      // Reset so a later request can retry the init.
      initPromise = null;
    });
  }
  return initPromise;
}

async function init(): Promise<void> {
  await Promise.all([recoverRelicJobs(), recoverAgentJobs()]);
}

async function recoverRelicJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.relicProcessingJob.findMany({
    where: { status: "RUNNING", updatedAt: { lt: cutoff } },
    select: { id: true, step: true },
  });
  if (stale.length === 0) return;

  console.warn(
    `[server-init] resuming ${stale.length} stale RUNNING relic job(s) older than ${STALE_MS / 1000}s`,
  );
  await prisma.relicProcessingJob.updateMany({
    where: { id: { in: stale.map((j) => j.id) } },
    data: { status: "PENDING", errorMessage: "auto-resumed after server restart" },
  });
  for (const job of stale) {
    void runRelicPipeline(job.id, { fromStep: job.step }).catch((e) => {
      console.error(`[server-init] resumed relic pipeline crashed for ${job.id}`, e);
    });
  }
}

async function recoverAgentJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.agentJob.findMany({
    where: { status: "RUNNING", updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (stale.length === 0) return;

  console.warn(
    `[server-init] resuming ${stale.length} stale RUNNING agent job(s) older than ${STALE_MS / 1000}s`,
  );
  await prisma.agentJob.updateMany({
    where: { id: { in: stale.map((j) => j.id) } },
    data: { status: "PENDING", errorMessage: "auto-resumed after server restart" },
  });
  for (const job of stale) {
    void runAgentJob(job.id).catch((e) => {
      console.error(`[server-init] resumed agent-job crashed for ${job.id}`, e);
    });
  }
}
