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
import { stepPackDerived } from "./steps/packDerived";
import { stepGenerateMetadata } from "./steps/generateMetadata";

const ERROR_MESSAGE_MAX_LEN = 500;

type StepDef = {
  id: RelicJobStep;
  weight: number;
  run: (ctx: PipelineContext) => Promise<StepResult>;
};

const STEPS: StepDef[] = [
  { id: "EXTRACT_ZIP", weight: 30, run: stepExtractZip as StepDef["run"] },
  // GENERATE_METADATA runs BEFORE PACK_DERIVED so the metadata snapshot baked
  // into derived/metadata.json reflects the AI-generated name/classif/rarity,
  // not the placeholder. The step never fails the pipeline (degrades to a
  // "needs curator" placeholder) — see steps/generateMetadata.ts.
  { id: "GENERATE_METADATA", weight: 40, run: stepGenerateMetadata as StepDef["run"] },
  { id: "PACK_DERIVED", weight: 30, run: stepPackDerived as StepDef["run"] },
];

const TOTAL_WEIGHT = STEPS.reduce((s, x) => s + x.weight, 0);

export async function runRelicPipeline(
  jobId: string,
  opts?: { fromStep?: RelicJobStep },
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

async function runInner(jobId: string, opts?: { fromStep?: RelicJobStep }): Promise<void> {
  const initial = await prisma.relicProcessingJob.findUnique({
    where: { id: jobId },
    include: { relic: true },
  });
  if (!initial) {
    console.warn("[pipeline] job vanished before start", { jobId });
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
    const fresh = await prisma.relicProcessingJob.findUnique({
      where: { id: jobId },
      include: { relic: true },
    });
    if (!fresh) {
      throw new Error("job vanished mid-pipeline");
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
    // First-time pipeline success → AWAITING_REVIEW so admin gets a
    // confirm step. Re-runs (admin clicked retry on a relic already past
    // review, e.g. status was READY/PARTIAL) keep their current status —
    // we don't want to demote an already-stored relic back to "pending".
    const target: "READY" | "AWAITING_REVIEW" =
      final.relic.status === "PROCESSING" || final.relic.status === "DRAFT"
        ? "AWAITING_REVIEW"
        : final.relic.status === "READY"
          ? "READY"
          : "AWAITING_REVIEW";
    await prisma.relic.update({
      where: { id: final.relic.id },
      data: { status: target },
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
