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
import type { AgentRunLogEntry } from "@/lib/agents/invoke";
import { callScene, SceneError } from "@/lib/agent-service";
import { recordRelicLog } from "@/lib/relicLog";
import type { PipelineContext, StepResult } from "../context";
import { scanWorkspace } from "../scanWorkspace";
import { stageUserCandidates } from "../stageUserCandidates";

// Pipeline step reads result.output from each scene directly. Each
// scene declares its own fixed outputSchema in lib/relics/scenes.ts,
// and the bound agent's tail transform produces that exact shape — no
// per-binding outputMap reshape (retired 2026-05-11).
//
// Phase 8.5 (smart-pick decomposition): the step calls TWO scenes
// sequentially:
//   1. relic.draft-metadata     → research fields + useUserImage/networkImageQuery decision
//   2. relic.smart-image-pick   → candidates + recommendedPrimaryPath
// The picker scene is gated on metadata-init's decision; on a failure
// of either scene we still write whatever shaped fields survive and let
// the downstream "degraded → PARTIAL" policy apply.
//
// Expected shape from draft-metadata:
//   { research: { titleZh, titleEn, subtitleZh, subtitleEn, icon,
//                 rarity, formKind, decisionReason, loreZh, loreEn,
//                 useUserImage, networkImageQuery } }
// Expected shape from smart-image-pick:
//   { recommendedPrimaryPath, candidates: [...] }

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

// Builds the writeback payload from two scene outputs:
//   - metaOutput: { research: {...} } from relic.draft-metadata
//   - pickOutput: { recommendedPrimaryPath, candidates } from
//     relic.smart-image-pick (or null when the picker scene was skipped
//     or failed)
// Either being null/incomplete falls through to FALLBACK fields; the
// step's overall `degraded` flag controls PARTIAL vs AWAITING_REVIEW.
function shapeMetadata(
  metaOutput: unknown,
  pickOutput: unknown,
): GenerateMetadataResult["applied"] {
  const metaRoot = isObject(metaOutput) ? metaOutput : {};
  const research = isObject(metaRoot.research) ? metaRoot.research : null;
  const pickOut = isObject(pickOutput) ? pickOutput : null;
  const meta = research ?? {};
  // Slice caps match cell truncate width budget (with small overshoot buffer).
  const classifZh = pickString(meta.subtitleZh ?? meta.classifZh, FALLBACK.classifZh, 10);
  const classifEn = pickString(meta.subtitleEn ?? meta.classifEn, FALLBACK.classifEn, 18);
  const formKind = pickFormKind(meta.formKind);
  const formReason = typeof meta.decisionReason === "string"
    ? pickString(meta.decisionReason, "", 500) || null
    : null;
  const loreZh = typeof meta.loreZh === "string" && meta.loreZh.trim()
    ? meta.loreZh.trim().slice(0, 4000)
    : null;
  const loreEn = typeof meta.loreEn === "string" && meta.loreEn.trim()
    ? meta.loreEn.trim().slice(0, 4000)
    : null;

  const primaryImagePath =
    pickOut && typeof pickOut.recommendedPrimaryPath === "string"
      ? pickOut.recommendedPrimaryPath
      : null;
  const candidateImages = pickOut ? shapeCandidates(pickOut.candidates) : null;

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
  // stageUserCandidates copies user images into derived/ as candidates
  // and picks a vision-filter reference.
  const scan = await scanWorkspace(workspaceSlug);
  const staged = await stageUserCandidates(workspaceSlug, scan.imageAbsPaths);

  // — Phase 1: draft-metadata (lore + 9-field metadata + image-pick decision)
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

  // — Phase 2: smart-image-pick (gated on metadata succeeding) —
  // The picker doesn't need lore — just the metadata's image-pick
  // decision (`useUserImage` + `networkImageQuery`) plus the staged
  // user candidates. Skip when metadata failed: there's nothing to
  // dispatch on.
  let pickOutput: unknown = undefined;
  let pickFailReason: string | undefined;
  const research = isObject(metaOutput) && isObject(metaOutput.research) ? metaOutput.research : null;
  const useUserImage = research && research.useUserImage !== false;
  const networkImageQuery =
    research && typeof research.networkImageQuery === "string" ? research.networkImageQuery : "";

  if (research) {
    try {
      const pickResult = await callScene(
        "relic.smart-image-pick",
        {
          workspaceSlug,
          useUserImage: !!useUserImage,
          networkImageQuery,
          userCandidates: staged.userCandidates,
          referenceImageAbs: staged.referenceImageAbs,
        },
        {
          onProgress: opts?.onProgress,
          timeoutMs: 5 * 60_000,
        },
      );
      if (Array.isArray(pickResult.runLog)) {
        draftRunLog.push(...(pickResult.runLog as AgentRunLogEntry[]));
      }
      if (pickResult.ok) {
        pickOutput = pickResult.output;
      } else {
        pickFailReason = `smart-image-pick failed (${pickResult.errorCode}): ${pickResult.errorMessage}`;
      }
    } catch (e) {
      if (e instanceof SceneError) {
        pickFailReason = `smart-image-pick scene dispatch failed (${e.errorCode}): ${e.message}`;
      } else {
        pickFailReason = `smart-image-pick callScene threw: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  // Fallback: if picker didn't run / failed but staging produced user
  // candidates, fall back to "biggest user image is primary". This
  // matches the historical INTERNAL handler's behaviour when network
  // search is disabled.
  if (!pickOutput && staged.userCandidates.length > 0) {
    const sorted = [...staged.userCandidates].sort((a, b) => b.score - a.score);
    pickOutput = {
      candidates: staged.userCandidates,
      recommendedPrimaryPath: sorted[0].path,
      networkFetchAttempted: false,
    };
  }

  // Build applied payload from whatever made it through.
  const applied = shapeMetadata(metaOutput, pickOutput);
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

  // Metadata succeeded; degrade only if picker had a real failure
  // (success without picker fallback also possible — see above).
  const pickerDegraded = !!pickFailReason && applied.candidateImages === null;
  return {
    applied,
    runLog: draftRunLog,
    agentInvoked: true,
    degraded: !succeeded || pickerDegraded,
    degradeReason: pickerDegraded
      ? pickFailReason
      : succeeded
        ? undefined
        : "agent leaf output missing required research fields — check LORE-FORGE tail transform",
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
