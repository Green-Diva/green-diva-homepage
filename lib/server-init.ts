import "server-only";
import type { RelicJobStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runRelicPipeline } from "@/lib/relics/pipeline";
import { runDraftPipeline } from "@/lib/relics/pipeline/draft/runner";
import { runFinalizePipeline } from "@/lib/relics/pipeline/finalize/runner";
import { runAgentJob } from "@/lib/skills/runtime/runner";
import { getInternalServiceToken } from "@/lib/internal-token";
// Side-effect import: triggers each module's scenes.ts → registerScene
// calls at module-init time so the agent-service registry is populated
// before the first dispatchScene call. See lib/scenes-init.ts.
import "@/lib/scenes-init";

// Auto-populate INTERNAL_SERVICE_TOKEN from SAFETY_SECRET on boot so
// HTTP_API skills can use `authEnv: "INTERNAL_SERVICE_TOKEN"` without
// admin maintaining an extra env. We don't crash on derivation errors
// (SAFETY_SECRET unset in some dev situations) — we just skip; the
// /api/internal/* endpoints will reject with 503 if the token isn't
// available, which is the correct behavior anyway.
try {
  if (!process.env.INTERNAL_SERVICE_TOKEN) {
    process.env.INTERNAL_SERVICE_TOKEN = getInternalServiceToken();
  }
} catch (e) {
  console.warn("[server-init] could not derive INTERNAL_SERVICE_TOKEN:", e);
}

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
  await Promise.all([
    recoverRelicJobs(),
    recoverRelicDrafts(),
    recoverAgentJobs(),
  ]);
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
    // Finalize jobs are single-step (PACK_DERIVED). The legacy three-step
    // pipeline drives everything else. We pick the runner by which step the
    // job was on when it stalled — PACK_DERIVED-only is the finalize runner.
    if (job.step === "PACK_DERIVED") {
      void runFinalizePipeline(job.id).catch((e) => {
        console.error(`[server-init] resumed finalize pipeline crashed for ${job.id}`, e);
      });
    } else {
      void runRelicPipeline(job.id, { fromStep: job.step }).catch((e) => {
        console.error(`[server-init] resumed relic pipeline crashed for ${job.id}`, e);
      });
    }
  }
}

async function recoverRelicDrafts(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.relicDraft.findMany({
    where: { status: "RUNNING", updatedAt: { lt: cutoff } },
    select: { id: true, step: true },
  });
  if (stale.length === 0) return;

  console.warn(
    `[server-init] resuming ${stale.length} stale RUNNING relic draft(s) older than ${STALE_MS / 1000}s`,
  );
  await prisma.relicDraft.updateMany({
    where: { id: { in: stale.map((d) => d.id) } },
    data: { status: "PENDING", errorMessage: "auto-resumed after server restart" },
  });
  for (const d of stale) {
    const fromStep =
      d.step === "EXTRACT_ZIP" || d.step === "GENERATE_METADATA"
        ? (d.step as Extract<RelicJobStep, "EXTRACT_ZIP" | "GENERATE_METADATA">)
        : undefined;
    void runDraftPipeline(d.id, fromStep ? { fromStep } : undefined).catch((e) => {
      console.error(`[server-init] resumed draft pipeline crashed for ${d.id}`, e);
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
