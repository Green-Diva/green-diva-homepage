import "server-only";
import { Prisma, type RelicJobStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordRelicLog } from "@/lib/relicLog";
import {
  ensurePipelineDirs,
  pipelineDirsForSlug,
  type PipelineContext,
  type StepResult,
} from "./context";
import { stepExtractZip } from "./steps/extractZip";
import { stepRemoveBg } from "./steps/removeBg";
import { stepStructuredFields } from "./steps/structuredFields";
import { stepGenerate3d } from "./steps/generate3d";
import { stepWebResearch } from "./steps/webResearch";
import { stepWriteLore } from "./steps/writeLore";
import { stepPackDerived } from "./steps/packDerived";

const ERROR_MESSAGE_MAX_LEN = 500;

type StepDef = {
  id: RelicJobStep;
  weight: number;
  run: (ctx: PipelineContext) => Promise<StepResult>;
};

const STEPS: StepDef[] = [
  { id: "EXTRACT_ZIP", weight: 5, run: stepExtractZip as StepDef["run"] },
  { id: "REMOVE_BG", weight: 15, run: stepRemoveBg as StepDef["run"] },
  { id: "STRUCTURED_FIELDS", weight: 10, run: stepStructuredFields as StepDef["run"] },
  { id: "GEN_3D", weight: 40, run: stepGenerate3d as StepDef["run"] },
  { id: "WEB_RESEARCH", weight: 10, run: stepWebResearch as StepDef["run"] },
  { id: "WRITE_LORE", weight: 15, run: stepWriteLore as StepDef["run"] },
  { id: "PACK_DERIVED", weight: 5, run: stepPackDerived as StepDef["run"] },
];

const TOTAL_WEIGHT = STEPS.reduce((s, x) => s + x.weight, 0);

/**
 * Top-level pipeline entrypoint. NEVER throws — any error is recorded onto the
 * job row and the relic is moved to PARTIAL/FAILED. Callers fire-and-forget.
 *
 * Pass `opts.fromStep` to resume from a specific step; results from previously
 * completed steps are restored from `Job.stepResults`. Used by:
 * - the manual retry endpoint (admin chooses which step to rewind to)
 * - the crash-recovery routine in lib/server-init.ts (resumes whichever step
 *   was in flight when the previous process died)
 */
export async function runRelicPipeline(
  jobId: string,
  opts?: { fromStep?: import("@prisma/client").RelicJobStep },
): Promise<void> {
  try {
    await runInner(jobId, opts);
  } catch (e) {
    console.error("[pipeline] crashed", { jobId, e });
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
      console.error("[pipeline] also failed to record FAILED status", e2);
    }
  }
}

async function runInner(
  jobId: string,
  opts?: { fromStep?: import("@prisma/client").RelicJobStep },
): Promise<void> {
  const initial = await prisma.relicProcessingJob.findUnique({
    where: { id: jobId },
    include: { relic: true, agent: true },
  });
  if (!initial) {
    console.warn("[pipeline] job vanished before start", { jobId });
    return;
  }
  if (!initial.agent) {
    await prisma.relicProcessingJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: "no agent attached to job",
        finishedAt: new Date(),
      },
    });
    return;
  }

  await prisma.relicProcessingJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });
  await prisma.relic.update({
    where: { id: initial.relicId },
    data: { status: "PROCESSING" },
  });

  const dirs = pipelineDirsForSlug(initial.relic.slug);
  await ensurePipelineDirs(dirs);

  // Resume support: restore prior step results + skip ahead to the requested step.
  const startIdx = (() => {
    if (!opts?.fromStep) return 0;
    const idx = STEPS.findIndex((s) => s.id === opts.fromStep);
    if (idx < 0 || opts.fromStep === "ENQUEUED" || opts.fromStep === "FINALIZE") return 0;
    return idx;
  })();
  const results = new Map<string, unknown>();
  if (
    startIdx > 0 &&
    initial.stepResults &&
    typeof initial.stepResults === "object" &&
    !Array.isArray(initial.stepResults)
  ) {
    for (const [id, data] of Object.entries(initial.stepResults as Record<string, unknown>)) {
      results.set(id, data);
    }
  }
  let cumWeight = STEPS.slice(0, startIdx).reduce((s, x) => s + x.weight, 0);

  for (let i = startIdx; i < STEPS.length; i++) {
    const step = STEPS[i];
    // Reload the relic + job to pick up upstream writes.
    const fresh = await prisma.relicProcessingJob.findUnique({
      where: { id: jobId },
      include: { relic: true, agent: true },
    });
    if (!fresh || !fresh.agent) {
      throw new Error("job or agent vanished mid-pipeline");
    }
    if (fresh.status === "CANCELLED") {
      console.warn("[pipeline] cancelled mid-run", { jobId });
      return;
    }

    await prisma.relicProcessingJob.update({
      where: { id: jobId },
      data: { step: step.id },
    });

    const ctx: PipelineContext = {
      job: fresh,
      relic: fresh.relic,
      agent: fresh.agent,
      dirs,
      results,
    };

    const startedAt = Date.now();
    let result: StepResult;
    let stepAttempts = 0;
    const maxStepAttempts = fresh.maxAttempts;
    while (true) {
      stepAttempts++;
      try {
        result = await step.run(ctx);
      } catch (e) {
        result = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      if (result.ok || stepAttempts >= maxStepAttempts || !isTransientError(result.error)) {
        break;
      }
      const backoffMs = Math.min(30_000, 1_000 * Math.pow(2, stepAttempts));
      console.warn(
        `[pipeline] ${step.id} attempt ${stepAttempts} transient failure, retrying in ${backoffMs}ms: ${result.error.slice(0, 200)}`,
      );
      await prisma.relicProcessingJob.update({
        where: { id: jobId },
        data: { attempt: { increment: 1 } },
      });
      await new Promise((r) => setTimeout(r, backoffMs));
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
    cumWeight += step.weight;
    const progress = Math.min(99, Math.round((cumWeight / TOTAL_WEIGHT) * 100));
    await prisma.relicProcessingJob.update({
      where: { id: jobId },
      data: {
        progress,
        stepResults: stepResultsJson(results),
      },
    });
    await recordRelicLog({
      action: "PROCESSING_STEP",
      relic: relicSnapshot(fresh.relic),
      actor: null,
      details: { step: step.id, ok: true, ms },
    });
  }

  // All steps succeeded.
  const final = await prisma.relicProcessingJob.findUnique({
    where: { id: jobId },
    include: { relic: true },
  });
  await prisma.relicProcessingJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      step: "FINALIZE",
      progress: 100,
      finishedAt: new Date(),
    },
  });
  if (final?.relic) {
    await prisma.relic.update({
      where: { id: final.relic.id },
      data: { status: "READY" },
    });
    await recordRelicLog({
      action: "PROCESSING_SUCCEEDED",
      relic: relicSnapshot(final.relic),
      actor: null,
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

function isTransientError(msg: string): boolean {
  return /\b5\d\d\b|timeout|ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN|fetch failed|socket hang up|terminated/i.test(
    msg,
  );
}
