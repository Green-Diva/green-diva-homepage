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
import { executeAgent, type AgentRunResult } from "@/lib/agents/invoke";
import { recordRelicLog } from "@/lib/relicLog";
import { AgentErrorCode, logError } from "@/lib/agent-errors";
// Side-effect: registers all relic.* scenes so getScene works when a
// runner job carries a sceneKey. Cheap import — same module dispatch.ts uses.
import "@/lib/scenes-init";
import { getScene } from "@/lib/agent-service/registry";

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

// Resume-checkpoint TTL. Meshy keeps async tasks ~24h server-side; capping at
// 6h leaves headroom and avoids burning poll budget on a taskId that has
// almost certainly been GC'd. Older checkpoints are dropped on read and the
// resumed run does a fresh submit instead.
const RESUME_TTL_MS = 6 * 60 * 60 * 1000;

type ResumeCheckpoint = {
  stepId: string;
  skillId: string;
  skillSlug: string;
  initialResponse: unknown;
  createdAt: string;
};

function readResumeCheckpoint(raw: unknown): ResumeCheckpoint | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const cp = raw as Record<string, unknown>;
  if (
    typeof cp.stepId !== "string" ||
    typeof cp.skillId !== "string" ||
    typeof cp.skillSlug !== "string" ||
    typeof cp.createdAt !== "string"
  ) {
    return null;
  }
  const ageMs = Date.now() - new Date(cp.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > RESUME_TTL_MS) return null;
  return {
    stepId: cp.stepId,
    skillId: cp.skillId,
    skillSlug: cp.skillSlug,
    initialResponse: cp.initialResponse,
    createdAt: cp.createdAt,
  };
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

    // Read persisted resume checkpoint before bumping status — the skill
    // executor will skip the matching POST and jump straight into polling.
    // Expired / malformed checkpoints are dropped here; the run falls back
    // to a fresh submit.
    const checkpoint = readResumeCheckpoint(job.resumeCheckpoint);
    const resumeBySkillStepId = checkpoint
      ? new Map<string, unknown>([[checkpoint.stepId, checkpoint.initialResponse]])
      : undefined;

    await prisma.agentJob.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        startedAt: job.startedAt ?? new Date(),
        attempts: { increment: 1 },
        errorCode: null,
        errorMessage: null,
        progressPercent: null,
        progressLabel: null,
      },
    });

    // Submit-checkpoint: HTTP_API submit-then-poll skills (e.g. Meshy) fire
    // this after POST returns but before polling completes. We persist the
    // initialResponse (carries the taskId) so a crashed / killed process can
    // be resumed by `server-init.ts` without re-submitting. Best-effort —
    // checkpoint write failures are swallowed; worst case is a duplicate
    // submit on recovery, which is identical to the pre-checkpoint behavior.
    const onSkillSubmitted = async (info: {
      stepId: string;
      skillId: string;
      skillSlug: string;
      initialResponse: unknown;
    }) => {
      try {
        const cp: ResumeCheckpoint = {
          stepId: info.stepId,
          skillId: info.skillId,
          skillSlug: info.skillSlug,
          initialResponse: info.initialResponse,
          createdAt: new Date().toISOString(),
        };
        await prisma.agentJob.update({
          where: { id: jobId },
          data: { resumeCheckpoint: cp as unknown as Prisma.InputJsonValue },
        });
      } catch (e) {
        console.warn(`[agent-job:run] ${jobId} checkpoint write failed (swallowed):`, e);
      }
    };

    // Intra-step progress: HTTP_API polling fires this per poll iteration.
    // Best-effort persist to AgentJob so the frontend's /asset-job poll
    // returns a fresh % every few seconds. Swallow errors (Prisma down,
    // job already terminal, etc.) — telemetry must never break a run.
    const onSkillProgress = async (snap: { percent?: number; label?: string }) => {
      try {
        await prisma.agentJob.update({
          where: { id: jobId },
          data: {
            ...(snap.percent !== undefined ? { progressPercent: snap.percent } : {}),
            ...(snap.label !== undefined ? { progressLabel: snap.label } : {}),
          },
        });
      } catch (e) {
        console.warn(`[agent-job:run] ${jobId} progress write failed (swallowed):`, e);
      }
    };

    let result: AgentRunResult;
    try {
      result = await executeAgent({
        agent: job.agent,
        mode: job.mode,
        input: job.input,
        onSkillProgress,
        onSkillSubmitted,
        resumeBySkillStepId,
      });
    } catch (e) {
      // Catastrophic — dispatcher itself threw (invalid mode, prisma down).
      // No runLog to preserve. Mark FAILED unconditionally.
      const message = e instanceof Error ? e.message : String(e);
      logError("agent-job:run", AgentErrorCode.AGENT_RUNTIME_ERROR, `${jobId} dispatcher threw: ${message}`);
      await prisma.agentJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorCode: AgentErrorCode.AGENT_RUNTIME_ERROR,
          errorMessage: message.slice(0, 1000),
          finishedAt: new Date(),
          resumeCheckpoint: Prisma.JsonNull,
        },
      });
      return;
    }

    if (result.ok) {
      // Scene contract validation — when this job was triggered via
      // dispatchScene, the agent's leaf output must match the bound
      // scene's outputSchema. Catches "agent's tail transform doesn't
      // produce the expected shape" loudly instead of silently writing
      // a partial Relic row. Direct invokeAgent calls (no sceneKey) skip.
      if (job.sceneKey) {
        const scene = getScene(job.sceneKey);
        if (scene) {
          const parsed = scene.outputSchema.safeParse(result.output);
          if (!parsed.success) {
            const detail = parsed.error.issues
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join("; ");
            await prisma.agentJob.update({
              where: { id: jobId },
              data: {
                status: "FAILED",
                errorCode: AgentErrorCode.SCENE_OUTPUT_INVALID,
                errorMessage: `agent leaf output didn't match scene "${job.sceneKey}" outputSchema: ${detail}`.slice(
                  0,
                  1000,
                ),
                output: jsonOrNull(result.output),
                runLog: result.runLog as unknown as Prisma.InputJsonValue,
                finishedAt: new Date(),
                resumeCheckpoint: Prisma.JsonNull,
              },
            });
            try {
              await recordRelicProcessingLog(
                job.input,
                job.sceneKey,
                jobId,
                "FAILED",
                `scene contract mismatch: ${detail}`,
              );
            } catch (e) {
              console.error(`[agent-job:run] ${jobId} relic log (scene-invalid) failed:`, e);
            }
            return;
          }
        }
      }

      await prisma.agentJob.update({
        where: { id: jobId },
        data: {
          status: "SUCCESS",
          output: jsonOrNull(result.output),
          runLog: result.runLog as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
          resumeCheckpoint: Prisma.JsonNull,
        },
      });
      // Data-driven writeback to Relic — agent leaf output's
      // `_relicWriteback: { id, fields }` (produced via the agent's
      // tail transform node or skill responseTransform) is applied
      // against an allowlist. Pure agent invocations without
      // `_relicWriteback` are no-ops.
      try {
        await maybeWriteRelicAsset(result.output);
      } catch (e) {
        console.error(`[agent-job:run] ${jobId} relic writeback failed:`, e);
      }
      try {
        await recordRelicProcessingLog(job.input, job.sceneKey, jobId, "SUCCEEDED");
      } catch (e) {
        console.error(`[agent-job:run] ${jobId} relic log (success) failed:`, e);
      }
      return;
    }

    // result.ok === false — preserve runLog, decide retry based on errorMessage.
    const message = result.errorMessage;
    const code = result.errorCode;
    logError("agent-job:run", code, `${jobId}: ${message}`);

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
        finishedAt: new Date(),
        resumeCheckpoint: Prisma.JsonNull,
      },
    });
    try {
      await recordRelicProcessingLog(job.input, job.sceneKey, jobId, "FAILED", message);
    } catch (e) {
      console.error(`[agent-job:run] ${jobId} relic log (failed) failed:`, e);
    }
  } catch (e) {
    // Catastrophic — couldn't even mark FAILED. One last attempt to record it.
    logError("agent-job:run", AgentErrorCode.RUNNER_CRASH, `${jobId} catastrophic top-level error`, e);
    try {
      await prisma.agentJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorCode: AgentErrorCode.RUNNER_CRASH,
          errorMessage: e instanceof Error ? e.message.slice(0, 500) : "runner crashed",
          finishedAt: new Date(),
          resumeCheckpoint: Prisma.JsonNull,
        },
      });
    } catch {
      // give up — DB itself is unhappy
    }
  }
}

// — Relic writeback hook — — — — — — — — — — — — — — — — — — — — — — —
//
// When the agent's leaf output carries `_relicWriteback: { id, fields }`,
// each whitelisted field is applied to that Relic row. Agents produce
// this shape via a tail `transform` node or a skill's responseTransform,
// so adding a new writeback target is purely a config change — no
// runner code edits.
//
// Outputs without `_relicWriteback` are no-ops, so general agent
// invocations are unaffected.
//
// Idempotent: re-running the same input writes the same fields. Safe to
// trigger multiple times (e.g. via retry).

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Allowlist of Relic columns that may be written via the data-driven
// `_relicWriteback.fields` channel. Anything else is dropped with a
// warning — we don't let agents write arbitrary columns (passwordHash,
// extractedById, status…) through this hook.
const ALLOWED_WRITEBACK_FIELDS = new Set<string>([
  "enhancedImagePath",
  "modelPath",
  "primaryImagePath",
  "loreZh",
  "loreEn",
  "nameZh",
  "nameEn",
  "classifZh",
  "classifEn",
  "rarity",
  "iconKey",
  "candidateImages",
  "pipelineTrace",
]);

async function maybeWriteRelicAsset(rawOutput: unknown): Promise<void> {
  if (!isObject(rawOutput)) return;
  const wb = rawOutput._relicWriteback;
  if (!isObject(wb)) return;
  const id = typeof wb.id === "string" ? wb.id : null;
  const fields = isObject(wb.fields) ? wb.fields : null;
  if (!id || !fields) return;

  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED_WRITEBACK_FIELDS.has(k)) {
      console.warn(
        `[agent-job:run] writeback skipped unknown field "${k}" for relic ${id} (not in allowlist)`,
      );
      continue;
    }
    safe[k] = v;
  }
  if (Object.keys(safe).length === 0) return;

  try {
    await prisma.relic.update({
      where: { id },
      data: safe as unknown as Prisma.RelicUpdateInput,
    });
  } catch (e) {
    console.error(`[agent-job:run] writeback failed for relic ${id}:`, e);
  }
}

// — RelicLog hook for relic-bound async invocations — — — — — — — — — — —
//
// PROCESSING_STARTED is recorded by the trigger endpoint (enhance-2d /
// create-3d). PROCESSING_SUCCEEDED / PROCESSING_FAILED is recorded here
// by the runner when the AgentJob terminates. Phase classification is
// driven by the dispatched scene key — sync scenes (relic.draft-metadata
// / relic.regen-metadata) record their own pipeline events elsewhere,
// so this hook is a no-op for them.
const SCENE_TO_RELIC_PHASE: Record<string, string> = {
  "relic.enhance2d": "enhance2d",
  "relic.create3d": "3d",
};

async function recordRelicProcessingLog(
  rawInput: unknown,
  sceneKey: string | null,
  jobId: string,
  outcome: "SUCCEEDED" | "FAILED",
  errorMessage?: string | null,
): Promise<void> {
  if (!isObject(rawInput)) return;
  const relicId = typeof rawInput._relicId === "string" ? rawInput._relicId : null;
  if (!relicId || !sceneKey) return;
  const phase = SCENE_TO_RELIC_PHASE[sceneKey];
  if (!phase) return;

  const relic = await prisma.relic.findUnique({
    where: { id: relicId },
    select: { id: true, slug: true, nameEn: true },
  });
  if (!relic) return;

  const details: Record<string, unknown> = { phase, jobId };
  if (errorMessage) details.error = errorMessage.slice(0, 200);

  await recordRelicLog({
    action: outcome === "SUCCEEDED" ? "PROCESSING_SUCCEEDED" : "PROCESSING_FAILED",
    relic: { id: relic.id, slug: relic.slug, name: relic.nameEn || relic.slug },
    actor: null,
    details: details as Prisma.InputJsonValue,
  });
}
