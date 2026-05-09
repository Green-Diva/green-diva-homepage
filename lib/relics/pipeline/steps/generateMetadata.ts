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

// Fallback strings honour the cell's truncate hard caps (≤4 中文字 title,
// ≤6 字符 subtitle Zh, ≤10 char title En, ≤14 char subtitle En —— English
// uppercase letters are ~2x the visual width of CJK at 10px tracking-[0.2em]).
const FALLBACK = {
  iconKey: "help_outline",
  nameZh: "待编修",
  nameEn: "Unnamed",
  classifZh: "档案 · 待考",
  classifEn: "Reliq · Lost",
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
  // Slice caps match cell truncate width budget (with small overshoot buffer).
  const classifZh = pickString(meta.subtitleZh ?? meta.classifZh, FALLBACK.classifZh, 10);
  const classifEn = pickString(meta.subtitleEn ?? meta.classifEn, FALLBACK.classifEn, 18);
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
    nameZh: pickString(meta.titleZh ?? meta.nameZh, FALLBACK.nameZh, 12),
    nameEn: pickString(meta.titleEn ?? meta.nameEn, FALLBACK.nameEn, 14),
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

// Workspace-agnostic core: runs the scribe agent against a workspace slug and
// shapes its runLog into the Relic-shaped writeback payload. Used by both
// the legacy Relic pipeline (workspace = relic.slug) and the new draft
// pipeline (workspace = "_drafts/<draftId>").
export type ScribeRunOutcome = {
  applied: GenerateMetadataResult["applied"];
  runLog: AgentRunLogEntry[];
  agentInvoked: boolean;
  degraded: boolean;
  degradeReason?: string;
};

export async function runScribeForWorkspace(
  workspaceSlug: string,
  opts?: {
    onProgress?: (info: { runLog: AgentRunLogEntry[] }) => void | Promise<void>;
  },
): Promise<ScribeRunOutcome> {
  const agent = await prisma.agent.findUnique({
    where: { codename: SCRIBE_CODENAME },
  });

  if (!agent) {
    return {
      applied: { ...FALLBACK_APPLIED },
      runLog: [],
      agentInvoked: false,
      degraded: true,
      degradeReason: `agent "${SCRIBE_CODENAME}" not configured`,
    };
  }
  if (!agent.deployedAt) {
    return {
      applied: { ...FALLBACK_APPLIED },
      runLog: [],
      agentInvoked: false,
      degraded: true,
      degradeReason: `agent "${SCRIBE_CODENAME}" exists but is not deployed`,
    };
  }

  let runResult;
  try {
    runResult = await invokeAgent({
      agent,
      mode: agent.mode,
      input: { mode: "initial", relicSlug: workspaceSlug },
      onProgress: opts?.onProgress,
    });
  } catch (e) {
    return {
      applied: { ...FALLBACK_APPLIED },
      runLog: [],
      agentInvoked: true,
      degraded: true,
      degradeReason: `invokeAgent threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!runResult.ok) {
    // Salvage whatever the runLog has (e.g. if research succeeded but pick
    // crashed). Still mark degraded → caller will translate to PARTIAL.
    const salvaged = shapeMetadata(runResult.runLog);
    return {
      applied: salvaged,
      runLog: runResult.runLog,
      agentInvoked: true,
      degraded: true,
      degradeReason: `agent run failed (${runResult.errorCode}): ${runResult.errorMessage}`,
    };
  }

  const applied = shapeMetadata(runResult.runLog);
  const succeeded = lookSuccess(applied);
  return {
    applied,
    runLog: runResult.runLog,
    agentInvoked: true,
    degraded: !succeeded,
    degradeReason: succeeded ? undefined : "research node missing or returned fallback",
  };
}

export async function stepGenerateMetadata(
  ctx: PipelineContext,
): Promise<StepResult<GenerateMetadataResult>> {
  const relicSnapshot = {
    id: ctx.relic.id,
    slug: ctx.relic.slug,
    name: ctx.relic.nameEn || ctx.relic.slug,
  };

  const outcome = await runScribeForWorkspace(ctx.relic.slug);

  try {
    const updateData: Prisma.RelicUpdateInput = {
      iconKey: outcome.applied.iconKey,
      nameZh: outcome.applied.nameZh,
      nameEn: outcome.applied.nameEn,
      classifZh: outcome.applied.classifZh,
      classifEn: outcome.applied.classifEn,
      rarity: outcome.applied.rarity,
      // Only overwrite optional fields when the agent actually produced a value
      // (preserves admin manual edits when the DAG missed a node).
      ...(outcome.applied.formKind !== null ? { formKind: outcome.applied.formKind } : {}),
      ...(outcome.applied.formReason !== null ? { formReason: outcome.applied.formReason } : {}),
      ...(outcome.applied.loreZh !== null ? { loreZh: outcome.applied.loreZh } : {}),
      ...(outcome.applied.loreEn !== null ? { loreEn: outcome.applied.loreEn } : {}),
      ...(outcome.applied.primaryImagePath !== null
        ? { primaryImagePath: outcome.applied.primaryImagePath }
        : {}),
      ...(outcome.applied.candidateImages !== null
        ? { candidateImages: outcome.applied.candidateImages as unknown as Prisma.InputJsonValue }
        : {}),
      pipelineTrace: outcome.runLog as unknown as Prisma.InputJsonValue,
    };
    await prisma.relic.update({ where: { id: ctx.relic.id }, data: updateData });
  } catch (e) {
    return {
      ok: false,
      error: `metadata write failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (outcome.degraded) {
    await recordRelicLog({
      action: "PROCESSING_STEP",
      relic: relicSnapshot,
      actor: null,
      notes: "GENERATE_METADATA degraded to fallback",
      details: {
        step: "GENERATE_METADATA",
        ok: true,
        degraded: true,
        reason: outcome.degradeReason ?? "unknown",
        applied: outcome.applied,
      },
    });
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
