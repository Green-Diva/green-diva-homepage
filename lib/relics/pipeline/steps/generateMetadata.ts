// Pipeline step: GENERATE_METADATA
//
// Calls the relic.generate-draft-metadata scene (bound to RELIC-FORGE-001
// mode=initial) and writes its outputs back into the Relic row:
//   - research.output → titles / subtitles / icon / rarity / loreZh / loreEn
//
// Primary image selection: the largest staged user candidate becomes
// primaryImagePath. The historical relic.smart-image-pick scene
// (PICKER-FORGE-001, retired 2026-05-14) has been removed entirely.
//
// Graceful-degradation policy: this step NEVER fails the pipeline. If the
// scribe agent isn't configured, isn't deployed, or its run fails for any
// reason, we write a "needs curator" placeholder and record a RelicLog
// entry. **The `data.degraded` flag is read by lib/relics/pipeline/index.ts
// to decide whether to land in AWAITING_REVIEW (success) vs PARTIAL
// (degraded) — failed first-time generation must NOT show as pending review.**

import "server-only";
import type { Rarity, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AgentRunLogEntry } from "@/lib/agents/invoke";
import { callScene, SceneError } from "@/lib/agent-service";
import { recordRelicLog } from "@/lib/relicLog";
import type { PipelineContext, StepResult } from "../context";
import { scanWorkspace } from "../scanWorkspace";
import { stageUserCandidates } from "../stageUserCandidates";

// Pipeline step reads result.output from the scene directly. The scene
// declares its own fixed outputSchema in lib/relics/scenes.ts, and the
// bound agent's tail transform produces that exact shape — no per-binding
// outputMap reshape (retired 2026-05-11).
//
// Expected shape from relic.generate-draft-metadata:
//   { research: { titleZh, titleEn, subtitleZh, subtitleEn, icon,
//                 rarity, decisionReason, loreZh, loreEn } }

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

// Builds the writeback payload from scene output + staged user candidates:
//   - metaOutput: { research: {...} } from relic.generate-draft-metadata
//   - pick: { recommendedPrimaryPath, candidates } derived from staged
//     user images (largest = primary), or null when no user candidates.
// metaOutput being null/incomplete falls through to FALLBACK fields; the
// step's overall `degraded` flag controls PARTIAL vs AWAITING_REVIEW.
function shapeMetadata(
  metaOutput: unknown,
  pick: { candidates: unknown; recommendedPrimaryPath: string } | null,
): GenerateMetadataResult["applied"] {
  const metaRoot = isObject(metaOutput) ? metaOutput : {};
  const research = isObject(metaRoot.research) ? metaRoot.research : null;
  const meta = research ?? {};
  // Slice caps match cell truncate width budget (with small overshoot buffer).
  const classifZh = pickString(meta.subtitleZh ?? meta.classifZh, FALLBACK.classifZh, 10);
  const classifEn = pickString(meta.subtitleEn ?? meta.classifEn, FALLBACK.classifEn, 18);
  const loreZh = typeof meta.loreZh === "string" && meta.loreZh.trim()
    ? meta.loreZh.trim().slice(0, 4000)
    : null;
  const loreEn = typeof meta.loreEn === "string" && meta.loreEn.trim()
    ? meta.loreEn.trim().slice(0, 4000)
    : null;

  const primaryImagePath = pick?.recommendedPrimaryPath ?? null;
  const candidateImages = pick ? shapeCandidates(pick.candidates) : null;

  return {
    iconKey: pickString(meta.icon ?? meta.iconKey, FALLBACK.iconKey, 64),
    nameZh: pickString(meta.titleZh ?? meta.nameZh, FALLBACK.nameZh, 12),
    nameEn: pickString(meta.titleEn ?? meta.nameEn, FALLBACK.nameEn, 14),
    classifZh,
    classifEn,
    rarity: pickRarity(meta.rarity),
    loreZh,
    loreEn,
    primaryImagePath,
    candidateImages,
  };
}

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

// Codes that mean "the agent never actually got to run" — we set
// agentInvoked: false so the pipeline summary can distinguish "wiring
// problem" from "agent ran but failed".
const PRE_RUN_FAILURE_CODES = new Set([
  "UNKNOWN_SCENE",
  "UNBOUND_SCENE",
  "BINDING_DISABLED",
  "AGENT_MISSING",
  "AGENT_NOT_DEPLOYED",
  "CONTEXT_INVALID",
  "TEMPLATE_ERROR",
]);

export async function runScribeForWorkspace(
  workspaceSlug: string,
  opts?: {
    onProgress?: (info: { runLog: AgentRunLogEntry[] }) => void | Promise<void>;
  },
): Promise<ScribeRunOutcome> {
  // Scan + stage at the pipeline layer. Both are pure IO; agents see only
  // shaped JSON. scanWorkspace prepares lore-writing context;
  // stageUserCandidates copies user images into derived/ as candidates.
  const scan = await scanWorkspace(workspaceSlug);
  const staged = await stageUserCandidates(workspaceSlug, scan.imageAbsPaths);

  // Pick primary image: largest staged user candidate. No agent involved.
  const pick =
    staged.userCandidates.length > 0
      ? (() => {
          const sorted = [...staged.userCandidates].sort((a, b) => b.score - a.score);
          return {
            candidates: staged.userCandidates,
            recommendedPrimaryPath: sorted[0].path,
          };
        })()
      : null;

  // Call relic.generate-draft-metadata for lore + metadata fields.
  const draftRunLog: AgentRunLogEntry[] = [];
  let metaOutput: unknown = undefined;
  let metaFailReason: string | undefined;
  let metaPreRun = false;

  try {
    const result = await callScene(
      "relic.generate-draft-metadata",
      {
        workspaceSlug,
        userBrief: scan.userBrief,
        fileSummary: scan.fileSummary,
        imageAbsPaths: scan.imageAbsPaths,
        textExcerpts: scan.textExcerpts,
      },
      {
        onProgress: opts?.onProgress,
        // ~30s grounded research + ~10s metadata derivation. 5 min
        // headroom; pipeline retry sits above for transient failures.
        timeoutMs: 5 * 60_000,
      },
    );
    if (Array.isArray(result.runLog)) draftRunLog.push(...(result.runLog as AgentRunLogEntry[]));
    if (result.ok) {
      metaOutput = result.output;
    } else {
      metaFailReason = `draft-metadata failed (${result.errorCode}): ${result.errorMessage}`;
    }
  } catch (e) {
    if (e instanceof SceneError) {
      metaPreRun = PRE_RUN_FAILURE_CODES.has(e.errorCode);
      metaFailReason = `draft-metadata scene dispatch failed (${e.errorCode}): ${e.message}`;
    } else {
      metaFailReason = `draft-metadata callScene threw: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Build applied payload from whatever made it through.
  const applied = shapeMetadata(metaOutput, pick);
  const succeeded = lookSuccess(applied);

  if (metaFailReason) {
    return {
      applied,
      runLog: draftRunLog,
      agentInvoked: !metaPreRun,
      degraded: true,
      degradeReason: metaFailReason,
    };
  }

  return {
    applied,
    runLog: draftRunLog,
    agentInvoked: true,
    degraded: !succeeded,
    degradeReason: succeeded
      ? undefined
      : "agent leaf output missing required research fields — check RELIC-FORGE tail transform",
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
