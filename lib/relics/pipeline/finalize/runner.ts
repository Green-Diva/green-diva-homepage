// Finalize-phase pipeline. Runs after the admin confirms a RelicDraft and
// the workspace has been renamed to its final slug. Currently a single
// step — PACK_DERIVED — but kept as its own module so future post-confirm
// work (re-packing, deriving thumbnails, etc.) can extend cleanly.
//
// Mirrors the legacy pipeline's RelicProcessingJob discipline: a job row
// tracks status/progress, the runner is fire-and-forget, and crash recovery
// re-runs RUNNING jobs that didn't finish.

import "server-only";
import { Prisma, type RelicJobStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordRelicLog } from "@/lib/relicLog";
import { ensurePipelineDirs, pipelineDirsForSlug, type PipelineContext } from "../context";
import { stepPackDerived } from "../steps/packDerived";

const ERROR_MESSAGE_MAX_LEN = 500;

type FinalizeStep = Extract<RelicJobStep, "PACK_DERIVED">;

const STEPS: { id: FinalizeStep; weight: number }[] = [
  { id: "PACK_DERIVED", weight: 100 },
];

export async function runFinalizePipeline(jobId: string): Promise<void> {
  try {
    await runInner(jobId);
  } catch (e) {
    console.error("[finalize-pipeline] crashed", { jobId, e });
    try {
      await prisma.relicProcessingJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: clamp(e instanceof Error ? e.message : String(e), ERROR_MESSAGE_MAX_LEN),
          finishedAt: new Date(),
        },
      });
    } catch (e2) {
      console.error("[finalize-pipeline] also failed to record FAILED status", e2);
    }
  }
}

async function runInner(jobId: string): Promise<void> {
  const job = await prisma.relicProcessingJob.findUnique({
    where: { id: jobId },
    include: { relic: true },
  });
  if (!job) {
    console.warn("[finalize-pipeline] job vanished before start", { jobId });
    return;
  }

  await prisma.relicProcessingJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });

  const dirs = pipelineDirsForSlug(job.relic.slug);
  await ensurePipelineDirs(dirs);
  const results = new Map<string, unknown>();

  for (const step of STEPS) {
    const fresh = await prisma.relicProcessingJob.findUnique({
      where: { id: jobId },
      include: { relic: true },
    });
    if (!fresh) throw new Error("job vanished mid-finalize");
    if (fresh.status === "CANCELLED") {
      console.warn("[finalize-pipeline] cancelled mid-run", { jobId });
      return;
    }

    await prisma.relicProcessingJob.update({
      where: { id: jobId },
      data: { step: step.id },
    });

    const ctx: PipelineContext = {
      job: fresh,
      relic: fresh.relic,
      dirs,
      results,
    };

    const startedAt = Date.now();
    let result;
    try {
      result = await stepPackDerived(ctx);
    } catch (e) {
      result = { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
    const ms = Date.now() - startedAt;

    if (!result.ok) {
      await recordRelicLog({
        action: "PROCESSING_STEP",
        relic: relicSnapshot(fresh.relic),
        actor: null,
        details: { step: step.id, ok: false, ms, error: result.error },
      });
      await prisma.relic.update({
        where: { id: fresh.relicId },
        data: { status: "PARTIAL" },
      });
      await prisma.relicProcessingJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: clamp(result.error, ERROR_MESSAGE_MAX_LEN),
          finishedAt: new Date(),
          stepResults: stepResultsJson(results),
        },
      });
      await recordRelicLog({
        action: "PROCESSING_FAILED",
        relic: relicSnapshot(fresh.relic),
        actor: null,
        details: { step: step.id },
      });
      return;
    }

    if (result.data !== undefined) {
      results.set(step.id, result.data);
    }
    await prisma.relicProcessingJob.update({
      where: { id: jobId },
      data: { progress: 99, stepResults: stepResultsJson(results) },
    });
    await recordRelicLog({
      action: "PROCESSING_STEP",
      relic: relicSnapshot(fresh.relic),
      actor: null,
      details: { step: step.id, ok: true, ms },
    });
  }

  const finalRelic = await prisma.relic.findUnique({ where: { id: job.relicId } });
  await prisma.relicProcessingJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      step: "FINALIZE",
      progress: 100,
      finishedAt: new Date(),
    },
  });
  await prisma.relic.update({
    where: { id: job.relicId },
    data: { status: "READY" },
  });
  if (finalRelic) {
    await recordRelicLog({
      action: "PROCESSING_SUCCEEDED",
      relic: relicSnapshot(finalRelic),
      actor: null,
      details: { phase: "finalize", finalStatus: "READY" },
    });
  }
}

function relicSnapshot(relic: { id: string; slug: string; nameEn: string }) {
  return { id: relic.id, slug: relic.slug, name: relic.nameEn || relic.slug };
}

function stepResultsJson(results: Map<string, unknown>): Prisma.InputJsonValue {
  return Object.fromEntries(results) as Prisma.InputJsonValue;
}

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
