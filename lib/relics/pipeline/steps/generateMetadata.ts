// Pipeline step: GENERATE_METADATA
//
// Calls the RELIC-SCRIBE-001 agent in `mode: "initial"` and writes its DAG
// outputs back into the Relic row:
//   - research.output → titles / subtitles / icon / rarity / formKind /
//     formReason (from decisionReason) / loreZh / loreEn
//   - pick.output    → candidateImages, recommendedPrimaryPath → primaryImagePath
//
// Graceful-degradation policy: this step NEVER fails the pipeline. If the
// scribe agent isn't configured, isn't deployed, or its run fails for any
// reason, we write a "needs curator" placeholder and record a RelicLog
// entry. **The `data.degraded` flag is read by lib/relics/pipeline/index.ts
// to decide whether to land in AWAITING_REVIEW (success) vs PARTIAL
// (degraded) — failed first-time generation must NOT show as pending review.**

import "server-only";
import type { Rarity, RelicFormKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invokeAgent, type AgentRunLogEntry } from "@/lib/agents/invoke";
import { recordRelicLog } from "@/lib/relicLog";
import type { PipelineContext, StepResult } from "../context";

const SCRIBE_CODENAME = "RELIC-SCRIBE-001";

const RARITY_VALUES: ReadonlyArray<Rarity> = [
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "SPECIAL",
];

const FALLBACK = {
  iconKey: "help_outline",
  nameZh: "待编修档案",
  nameEn: "Pending Review",
  classifZh: "档案 · 等待编修",
  classifEn: "Archive · Awaiting Curator",
  rarity: "COMMON" as Rarity,
};

// DAG node IDs the scribe agent's Backbone is expected to use. The pipeline
// step pulls each node's output from the runLog to assemble the writeback
// payload. If the user rebuilds the DAG with different IDs, fields go
// untouched (degrade gracefully).
const DAG_NODE_IDS = {
  research: "research",
  pick: "pick",
} as const;

type CandidateImage = {
  path: string;
  source: "user" | "network";
  originalFilename?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  score: number;
  deleted: boolean;
};

export type GenerateMetadataResult = {
  agentInvoked: boolean;
  degraded: boolean;
  degradeReason?: string;
  applied: {
    iconKey: string;
    nameZh: string;
    nameEn: string;
    classifZh: string;
    classifEn: string;
    rarity: Rarity;
    formKind: RelicFormKind | null;
    formReason: string | null;
    loreZh: string | null;
    loreEn: string | null;
    primaryImagePath: string | null;
    candidateImages: CandidateImage[] | null;
  };
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(v: unknown, fallback: string, maxLen: number): string {
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

function pickRarity(v: unknown): Rarity {
  if (typeof v === "string") {
    const upper = v.toUpperCase() as Rarity;
    if (RARITY_VALUES.includes(upper)) return upper;
  }
  return FALLBACK.rarity;
}

function pickFormKind(v: unknown): RelicFormKind | null {
  if (v === "TWO_D" || v === "THREE_D") return v;
  if (typeof v === "string") {
    const norm = v.trim().toUpperCase().replace(/[-_\s]/g, "");
    if (norm === "2D" || norm === "TWOD" || norm === "TWO" || norm === "TWOD2D") return "TWO_D";
    if (norm === "3D" || norm === "THREED" || norm === "THREE") return "THREE_D";
  }
  return null;
}

function findNodeOutput(runLog: AgentRunLogEntry[], stepId: string): unknown | undefined {
  for (let i = runLog.length - 1; i >= 0; i -= 1) {
    const e = runLog[i];
    if (e.stepId === stepId && e.ok && !e.skipped) return e.output;
  }
  return undefined;
}

function shapeCandidates(raw: unknown): CandidateImage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CandidateImage[] = [];
  for (const c of raw) {
    if (!isObject(c)) continue;
    if (typeof c.path !== "string") continue;
    const source = c.source === "network" ? "network" : "user";
    out.push({
      path: c.path,
      source,
      originalFilename: typeof c.originalFilename === "string" ? c.originalFilename : undefined,
      sourceUrl: typeof c.sourceUrl === "string" ? c.sourceUrl : undefined,
      width: typeof c.width === "number" ? c.width : undefined,
      height: typeof c.height === "number" ? c.height : undefined,
      score: typeof c.score === "number" ? c.score : 0,
      deleted: c.deleted === true,
    });
  }
  return out.length > 0 ? out : null;
}

// Builds the writeback payload from the agent's runLog. Each field is
// independently optional — a partial DAG run still produces a partial
// payload, the pipeline step's overall `degraded` flag tells the runner
// whether to mark PARTIAL or AWAITING_REVIEW.
function shapeMetadata(runLog: AgentRunLogEntry[]): GenerateMetadataResult["applied"] {
  const research = findNodeOutput(runLog, DAG_NODE_IDS.research);
  const meta = isObject(research) ? research : {};
  const classifZh = pickString(meta.subtitleZh ?? meta.classifZh, FALLBACK.classifZh, 64);
  const classifEn = pickString(meta.subtitleEn ?? meta.classifEn, FALLBACK.classifEn, 80);
  const formKind = pickFormKind(meta.formKind);
  const formReason = isObject(meta) && typeof meta.decisionReason === "string"
    ? pickString(meta.decisionReason, "", 500) || null
    : null;
  const loreZh = isObject(meta) && typeof meta.loreZh === "string" && meta.loreZh.trim()
    ? meta.loreZh.trim().slice(0, 4000)
    : null;
  const loreEn = isObject(meta) && typeof meta.loreEn === "string" && meta.loreEn.trim()
    ? meta.loreEn.trim().slice(0, 4000)
    : null;

  const pickOut = findNodeOutput(runLog, DAG_NODE_IDS.pick);
  const primaryImagePath =
    isObject(pickOut) && typeof pickOut.recommendedPrimaryPath === "string"
      ? pickOut.recommendedPrimaryPath
      : null;
  const candidateImages = isObject(pickOut) ? shapeCandidates(pickOut.candidates) : null;

  return {
    iconKey: pickString(meta.icon ?? meta.iconKey, FALLBACK.iconKey, 64),
    nameZh: pickString(meta.titleZh ?? meta.nameZh, FALLBACK.nameZh, 48),
    nameEn: pickString(meta.titleEn ?? meta.nameEn, FALLBACK.nameEn, 80),
    classifZh,
    classifEn,
    rarity: pickRarity(meta.rarity),
    formKind,
    formReason,
    loreZh,
    loreEn,
    primaryImagePath,
    candidateImages,
  };
}

const FALLBACK_APPLIED: GenerateMetadataResult["applied"] = {
  ...FALLBACK,
  formKind: null,
  formReason: null,
  loreZh: null,
  loreEn: null,
  primaryImagePath: null,
  candidateImages: null,
};

// Heuristic for "the agent really succeeded" — research node produced both
// title fields. Used by both the step and downstream pipeline finalize.
function lookSuccess(applied: GenerateMetadataResult["applied"]): boolean {
  return (
    applied.iconKey !== FALLBACK.iconKey &&
    applied.nameZh !== FALLBACK.nameZh &&
    applied.nameEn !== FALLBACK.nameEn
  );
}

export async function stepGenerateMetadata(
  ctx: PipelineContext,
): Promise<StepResult<GenerateMetadataResult>> {
  const relicSnapshot = {
    id: ctx.relic.id,
    slug: ctx.relic.slug,
    name: ctx.relic.nameEn || ctx.relic.slug,
  };

  const agent = await prisma.agent.findUnique({
    where: { codename: SCRIBE_CODENAME },
  });

  if (!agent) {
    return await applyAndReturn({
      ctx,
      relicSnapshot,
      degraded: true,
      degradeReason: `agent "${SCRIBE_CODENAME}" not configured`,
      applied: { ...FALLBACK_APPLIED },
      runLog: [],
      agentInvoked: false,
    });
  }
  if (!agent.deployedAt) {
    return await applyAndReturn({
      ctx,
      relicSnapshot,
      degraded: true,
      degradeReason: `agent "${SCRIBE_CODENAME}" exists but is not deployed`,
      applied: { ...FALLBACK_APPLIED },
      runLog: [],
      agentInvoked: false,
    });
  }

  let runResult;
  try {
    runResult = await invokeAgent({
      agent,
      mode: agent.mode,
      input: { mode: "initial", relicSlug: ctx.relic.slug },
    });
  } catch (e) {
    return await applyAndReturn({
      ctx,
      relicSnapshot,
      degraded: true,
      degradeReason: `invokeAgent threw: ${e instanceof Error ? e.message : String(e)}`,
      applied: { ...FALLBACK_APPLIED },
      runLog: [],
      agentInvoked: true,
    });
  }

  if (!runResult.ok) {
    // Salvage whatever the runLog has (e.g. if research succeeded but pick
    // crashed). Still mark degraded → pipeline finalize will pick PARTIAL.
    const salvaged = shapeMetadata(runResult.runLog);
    return await applyAndReturn({
      ctx,
      relicSnapshot,
      degraded: true,
      degradeReason: `agent run failed (${runResult.errorCode}): ${runResult.errorMessage}`,
      applied: salvaged,
      runLog: runResult.runLog,
      agentInvoked: true,
    });
  }

  const applied = shapeMetadata(runResult.runLog);
  // Even if invokeAgent says ok, double-check the writeback looks complete.
  const succeeded = lookSuccess(applied);
  return await applyAndReturn({
    ctx,
    relicSnapshot,
    degraded: !succeeded,
    degradeReason: succeeded ? undefined : "research node missing or returned fallback",
    applied,
    runLog: runResult.runLog,
    agentInvoked: true,
  });
}

async function applyAndReturn(args: {
  ctx: PipelineContext;
  relicSnapshot: { id: string; slug: string; name: string };
  degraded: boolean;
  degradeReason?: string;
  applied: GenerateMetadataResult["applied"];
  agentInvoked: boolean;
  runLog: AgentRunLogEntry[];
}): Promise<StepResult<GenerateMetadataResult>> {
  const { ctx, relicSnapshot, degraded, degradeReason, applied, agentInvoked, runLog } = args;

  try {
    const updateData: Prisma.RelicUpdateInput = {
      iconKey: applied.iconKey,
      nameZh: applied.nameZh,
      nameEn: applied.nameEn,
      classifZh: applied.classifZh,
      classifEn: applied.classifEn,
      rarity: applied.rarity,
      // Only overwrite optional fields when the agent actually produced a value
      // (preserves admin manual edits when the DAG missed a node).
      ...(applied.formKind !== null ? { formKind: applied.formKind } : {}),
      ...(applied.formReason !== null ? { formReason: applied.formReason } : {}),
      ...(applied.loreZh !== null ? { loreZh: applied.loreZh } : {}),
      ...(applied.loreEn !== null ? { loreEn: applied.loreEn } : {}),
      ...(applied.primaryImagePath !== null ? { primaryImagePath: applied.primaryImagePath } : {}),
      ...(applied.candidateImages !== null
        ? { candidateImages: applied.candidateImages as unknown as Prisma.InputJsonValue }
        : {}),
      pipelineTrace: runLog as unknown as Prisma.InputJsonValue,
    };
    await prisma.relic.update({ where: { id: ctx.relic.id }, data: updateData });
  } catch (e) {
    return {
      ok: false,
      error: `metadata write failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (degraded) {
    await recordRelicLog({
      action: "PROCESSING_STEP",
      relic: relicSnapshot,
      actor: null,
      notes: "GENERATE_METADATA degraded to fallback",
      details: {
        step: "GENERATE_METADATA",
        ok: true,
        degraded: true,
        reason: degradeReason ?? "unknown",
        applied,
      },
    });
  }

  return {
    ok: true,
    data: { agentInvoked, degraded, degradeReason, applied },
  };
}
