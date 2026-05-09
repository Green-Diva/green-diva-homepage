// Draft-phase pipeline. Runs against a RelicDraft row before any Relic
// exists, writing the AI-generated metadata back into RelicDraft itself.
// On success the draft moves to READY_TO_REVIEW and the admin sees the
// preview/edit modal in the vault grid; on failure it stays FAILED until
// retried or cancelled.
//
// Two steps only — EXTRACT_ZIP and GENERATE_METADATA. PACK_DERIVED is
// deferred to the post-confirm finalize pipeline (see finalize/runner.ts)
// because we don't want to spend time packing a draft the admin may
// abandon.

import "server-only";
import { Prisma, type RelicJobStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AgentRunLogEntry } from "@/lib/agents/invoke";
import {
  ensurePipelineDirs,
  pipelineDirsForDraft,
  draftWorkspaceSlug,
  type StepResult,
} from "../context";
import { extractOrClassify, type ExtractZipResult } from "../steps/extractZip";
import {
  runScribeForWorkspace,
  type GenerateMetadataResult,
} from "../steps/generateMetadata";

const ERROR_MESSAGE_MAX_LEN = 500;

// Per-node progress checkpoints for the scribe agent's `initial` mode path.
// The DAG is mode-router → summary → research → pick (3 skipped leaves).
// We map each live node's completion to a progress percentage in the
// [EXTRACT_ZIP done .. step done] range. `research` carries most of the
// weight because it's the slow Gemini call (~15-20s); the others are <2s.
// Nodes not in this map still get pipelineTrace persisted but no progress
// bump — safe default for future DAG nodes.
const SCRIBE_INITIAL_NODE_PROGRESS: Record<string, number> = {
  mode: 55,
  summary: 62,
  research: 92,
  pick: 98,
};

// Subset of RelicJobStep that the draft pipeline actually uses. Stored on
// RelicDraft.step the same way RelicProcessingJob.step works.
type DraftStep = Extract<RelicJobStep, "EXTRACT_ZIP" | "GENERATE_METADATA">;

const STEPS: { id: DraftStep; weight: number }[] = [
  { id: "EXTRACT_ZIP", weight: 50 },
  { id: "GENERATE_METADATA", weight: 50 },
];

const TOTAL_WEIGHT = STEPS.reduce((s, x) => s + x.weight, 0);

export async function runDraftPipeline(
  draftId: string,
  opts?: { fromStep?: DraftStep },
): Promise<void> {
  try {
    await runInner(draftId, opts);
  } catch (e) {
    console.error("[draft-pipeline] crashed", { draftId, e });
    try {
      await prisma.relicDraft.update({
        where: { id: draftId },
        data: {
          status: "FAILED",
          errorMessage: clamp(e instanceof Error ? e.message : String(e), ERROR_MESSAGE_MAX_LEN),
          finishedAt: new Date(),
        },
      });
    } catch (e2) {
      console.error("[draft-pipeline] also failed to record FAILED status", e2);
    }
  }
}

async function runInner(draftId: string, opts?: { fromStep?: DraftStep }): Promise<void> {
  const initial = await prisma.relicDraft.findUnique({ where: { id: draftId } });
  if (!initial) {
    console.warn("[draft-pipeline] draft vanished before start", { draftId });
    return;
  }
  if (initial.status === "CANCELLED") {
    console.warn("[draft-pipeline] draft cancelled before start", { draftId });
    return;
  }

  await prisma.relicDraft.update({
    where: { id: draftId },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });

  const dirs = pipelineDirsForDraft(draftId);
  await ensurePipelineDirs(dirs);

  const startIdx = (() => {
    if (!opts?.fromStep) return 0;
    const idx = STEPS.findIndex((s) => s.id === opts.fromStep);
    return idx < 0 ? 0 : idx;
  })();

  // Restore any prior step results so a partial retry can reuse upstream
  // work (mirrors the legacy pipeline's behaviour).
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
    const fresh = await prisma.relicDraft.findUnique({ where: { id: draftId } });
    if (!fresh) throw new Error("draft vanished mid-pipeline");
    if (fresh.status === "CANCELLED") {
      console.warn("[draft-pipeline] cancelled mid-run", { draftId });
      return;
    }

    // Bump progress to a small "step started" value so the bar moves
    // immediately on entering the step. Without this the bar sits at the
    // previous step's value through the entirety of EXTRACT_ZIP (~1-3s)
    // and at 50% through the entirety of GENERATE_METADATA (~30s) — long
    // enough for users to think it's frozen. We use 10% of the step's
    // weight as the entrance bump.
    const stepEntranceProgress = Math.min(
      99,
      Math.round(cumWeight + step.weight * 0.1),
    );
    await prisma.relicDraft.update({
      where: { id: draftId },
      data: {
        step: step.id,
        progress: Math.max(fresh.progress, stepEntranceProgress),
      },
    });

    const startedAt = Date.now();
    let result: StepResult;
    let attempts = 0;
    const maxAttempts = fresh.maxAttempts;
    while (true) {
      attempts++;
      try {
        result = await runStep(step.id, draftId, fresh.archivePath, dirs.extracted);
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (result.ok || attempts >= maxAttempts || !isTransientError(result.error)) break;
      const backoffMs = Math.min(30_000, 1_000 * Math.pow(2, attempts));
      console.warn(
        `[draft-pipeline] ${step.id} attempt ${attempts} transient failure, retrying in ${backoffMs}ms: ${result.error.slice(0, 200)}`,
      );
      await prisma.relicDraft.update({
        where: { id: draftId },
        data: { attempt: { increment: 1 } },
      });
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    const ms = Date.now() - startedAt;

    if (!result.ok) {
      await prisma.relicDraft.update({
        where: { id: draftId },
        data: {
          status: "FAILED",
          errorMessage: clamp(result.error, ERROR_MESSAGE_MAX_LEN),
          finishedAt: new Date(),
          stepResults: stepResultsJson(results),
        },
      });
      console.warn("[draft-pipeline] step failed", { draftId, step: step.id, ms, error: result.error.slice(0, 300) });
      return;
    }

    if (result.data !== undefined) {
      results.set(step.id, result.data);
    }
    cumWeight += step.weight;
    const progress = Math.min(99, Math.round((cumWeight / TOTAL_WEIGHT) * 100));
    await prisma.relicDraft.update({
      where: { id: draftId },
      data: { progress, stepResults: stepResultsJson(results) },
    });
  }

  // Decide final status. Hard rule (mirrors legacy pipeline): a draft only
  // becomes READY_TO_REVIEW if the metadata step fully succeeded. Degraded
  // results (agent unavailable, salvaged partial output) → FAILED, so the
  // admin sees a clear "retry or abandon" prompt instead of a half-baked
  // preview.
  const meta = results.get("GENERATE_METADATA") as GenerateMetadataResult | undefined;
  const degraded = meta?.degraded === true;
  const target: "READY_TO_REVIEW" | "FAILED" = degraded ? "FAILED" : "READY_TO_REVIEW";

  await prisma.relicDraft.update({
    where: { id: draftId },
    data: {
      status: target,
      step: "FINALIZE",
      progress: 100,
      finishedAt: new Date(),
      errorMessage: degraded ? clamp(meta?.degradeReason ?? "metadata generation degraded", ERROR_MESSAGE_MAX_LEN) : null,
    },
  });
}

async function runStep(
  step: DraftStep,
  draftId: string,
  archivePath: string | null,
  extractedDir: string,
): Promise<StepResult> {
  if (step === "EXTRACT_ZIP") {
    return await extractOrClassify({ archivePath, extractedDir });
  }
  if (step === "GENERATE_METADATA") {
    return await runMetadataAndWriteback(draftId);
  }
  return { ok: false, error: `unknown draft step: ${step}` };
}

async function runMetadataAndWriteback(
  draftId: string,
): Promise<StepResult<GenerateMetadataResult>> {
  const workspace = draftWorkspaceSlug(draftId);

  // Stream per-node progress to the DB so the polling client can see
  // the bar advance through 55 → 62 → 92 → 98 instead of jumping straight
  // from 50 to 99 after the whole agent finishes. Also writes the partial
  // runLog so the UI can render an activity log in real time.
  const onProgress = async ({ runLog }: { runLog: AgentRunLogEntry[] }) => {
    if (runLog.length === 0) return;
    const last = runLog[runLog.length - 1];
    const pct = last.skipped ? undefined : SCRIBE_INITIAL_NODE_PROGRESS[last.stepId];
    try {
      await prisma.relicDraft.update({
        where: { id: draftId },
        data: {
          ...(pct !== undefined ? { progress: pct } : {}),
          pipelineTrace: runLog as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      // Non-fatal: the agent will still write the final trace at the end.
      console.warn("[draft-pipeline] progress writeback failed", e);
    }
  };

  const outcome = await runScribeForWorkspace(workspace, { onProgress });

  // Stash the runLog + AI output on the draft. Unlike the Relic version,
  // there's no Relic row to fan these out to — generatedMetadata holds the
  // whole thing until confirm time.
  try {
    await prisma.relicDraft.update({
      where: { id: draftId },
      data: {
        generatedMetadata: outcome.applied as unknown as Prisma.InputJsonValue,
        pipelineTrace: outcome.runLog as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    return {
      ok: false,
      error: `metadata write failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return {
    ok: true,
    data: {
      agentInvoked: outcome.agentInvoked,
      degraded: outcome.degraded,
      degradeReason: outcome.degradeReason,
      applied: outcome.applied,
    },
  };
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

// Suppress unused-import warnings from re-exported types.
export type { ExtractZipResult, GenerateMetadataResult };
