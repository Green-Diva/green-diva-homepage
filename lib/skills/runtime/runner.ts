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
import { recordRelicLog } from "@/lib/relicLog";

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
      try {
        await recordRelicProcessingLog(job.input, jobId, "SUCCEEDED");
      } catch (e) {
        console.error(`[agent-job:run] ${jobId} relic log (success) failed:`, e);
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
    try {
      await recordRelicProcessingLog(job.input, jobId, "FAILED", message);
    } catch (e) {
      console.error(`[agent-job:run] ${jobId} relic log (failed) failed:`, e);
    }
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
// Two paths, tried in order:
//
// 1. Data-driven (preferred — Phase 2.3+): when the agent's leaf output
//    carries `_relicWriteback: { id, fields }`, apply each whitelisted
//    field to that Relic row. Skills produce this shape via SceneBinding
//    outputMap or directly in their leaf output, so adding a new
//    writeback target is purely a config change — no runner code edits.
//
// 2. Legacy hardcoded (Phase 0b → 2.4 transition): when input.mode +
//    input._relicId match a known shape (2dEnhance / 3dCreate), apply
//    the per-mode field. Removed after Phase 2.4 finishes migrating all
//    relic.* scenes to emit `_relicWriteback`.
//
// Unknown modes / inputs without `_relicId` and without `_relicWriteback`
// are no-ops, so general agent invocations are unaffected.
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
  "formKind",
  "formReason",
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

async function tryDataDrivenWriteback(rawOutput: unknown): Promise<boolean> {
  if (!isObject(rawOutput)) return false;
  const wb = rawOutput._relicWriteback;
  if (!isObject(wb)) return false;
  const id = typeof wb.id === "string" ? wb.id : null;
  const fields = isObject(wb.fields) ? wb.fields : null;
  if (!id || !fields) return false;

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
  if (Object.keys(safe).length === 0) return true; // recognized but nothing to write

  try {
    await prisma.relic.update({
      where: { id },
      data: safe as unknown as Prisma.RelicUpdateInput,
    });
  } catch (e) {
    console.error(`[agent-job:run] data-driven writeback failed for relic ${id}:`, e);
  }
  return true;
}

async function tryLegacyModeWriteback(
  rawInput: unknown,
  rawOutput: unknown,
): Promise<boolean> {
  if (!isObject(rawInput)) return false;
  const relicId = typeof rawInput._relicId === "string" ? rawInput._relicId : null;
  const mode = typeof rawInput.mode === "string" ? rawInput.mode : null;
  if (!relicId || !mode) return false;

  if (mode === "2dEnhance") {
    if (!isObject(rawOutput)) return true; // recognized mode, nothing to write
    const enhancedImagePath =
      typeof rawOutput.enhancedImagePath === "string" ? rawOutput.enhancedImagePath : null;
    if (!enhancedImagePath) return true;
    await prisma.relic.update({ where: { id: relicId }, data: { enhancedImagePath } });
    return true;
  }

  if (mode === "3dCreate") {
    if (!isObject(rawOutput)) return true;
    const modelPath =
      typeof rawOutput.modelPath === "string" ? rawOutput.modelPath : null;
    if (!modelPath) return true;
    await prisma.relic.update({ where: { id: relicId }, data: { modelPath } });
    return true;
  }

  // initial / regenMetadata are sync — pipeline / regen endpoint write
  // from caller context. Not our problem here.
  return false;
}

async function maybeWriteRelicAsset(
  rawInput: unknown,
  rawOutput: unknown,
): Promise<void> {
  if (await tryDataDrivenWriteback(rawOutput)) return;
  await tryLegacyModeWriteback(rawInput, rawOutput);
}

// — RelicLog hook for relic-bound async invocations — — — — — — — — — — —
//
// PROCESSING_STARTED is recorded by the trigger endpoint (enhance-2d /
// create-3d). PROCESSING_SUCCEEDED / PROCESSING_FAILED is recorded here
// by the runner when the AgentJob terminates. Sync modes (initial /
// regenMetadata) record their own pipeline events elsewhere — this hook
// is a no-op for them.
async function recordRelicProcessingLog(
  rawInput: unknown,
  jobId: string,
  outcome: "SUCCEEDED" | "FAILED",
  errorMessage?: string | null,
): Promise<void> {
  if (!isObject(rawInput)) return;
  const relicId = typeof rawInput._relicId === "string" ? rawInput._relicId : null;
  const mode = typeof rawInput.mode === "string" ? rawInput.mode : null;
  if (!relicId || !mode) return;
  const phase = mode === "2dEnhance" ? "enhance2d" : mode === "3dCreate" ? "3d" : null;
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
