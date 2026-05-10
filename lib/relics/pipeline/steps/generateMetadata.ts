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

// Phase 5: pipeline step now reads result.output directly. The bound
// agent's SceneBinding outputMap is responsible for shaping `output` to
// expose `research` and `pick` keys (typically by pulling from
// runLog.byId.<nodeId>.output). This decouples the pipeline from the
// agent's internal node IDs — admin can swap agents without rewriting
// the pipeline as long as the new agent's binding produces the same
// output shape.
//
// Expected shape of result.output:
//   {
//     research: { titleZh, titleEn, subtitleZh, subtitleEn, icon,
//                 rarity, formKind, decisionReason, loreZh, loreEn },
//     pick:     { recommendedPrimaryPath, candidates: [...] }
//   }

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

// Builds the writeback payload from the bound agent's outputMap-shaped
// output. Each field is independently optional — a partial DAG run still
// produces a partial payload, the pipeline step's overall `degraded` flag
// tells the runner whether to mark PARTIAL or AWAITING_REVIEW.
//
// Expected shape: { research?: {...}, pick?: {...} }. Whatever doesn't
// match falls through to FALLBACK.
function shapeMetadata(output: unknown): GenerateMetadataResult["applied"] {
  const root = isObject(output) ? output : {};
  const research = isObject(root.research) ? root.research : null;
  const pickOut = isObject(root.pick) ? root.pick : null;
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
  let result;
  try {
    result = await callScene(
      "relic.draft-metadata",
      { workspaceSlug },
      {
        onProgress: opts?.onProgress,
        // Initial mode: grounded research (~30s) + metadata derivation
        // (~10s) + smart-pick. 5 minutes of headroom; pipeline retry
        // sits above this for transient failures.
        timeoutMs: 5 * 60_000,
      },
    );
  } catch (e) {
    if (e instanceof SceneError) {
      return {
        applied: { ...FALLBACK_APPLIED },
        runLog: [],
        agentInvoked: !PRE_RUN_FAILURE_CODES.has(e.code),
        degraded: true,
        degradeReason: `scene dispatch failed (${e.code}): ${e.message}`,
      };
    }
    return {
      applied: { ...FALLBACK_APPLIED },
      runLog: [],
      agentInvoked: true,
      degraded: true,
      degradeReason: `callScene threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const runLog = (Array.isArray(result.runLog) ? result.runLog : []) as AgentRunLogEntry[];

  if (!result.ok) {
    // Salvage whatever fields the failure runLog produced. The output
    // is undefined on failure — pipeline FALLBACK applies.
    const salvaged = shapeMetadata(undefined);
    return {
      applied: salvaged,
      runLog,
      agentInvoked: true,
      degraded: true,
      degradeReason: `agent run failed (${result.errorCode}): ${result.errorMessage}`,
    };
  }

  const applied = shapeMetadata(result.output);
  const succeeded = lookSuccess(applied);
  return {
    applied,
    runLog,
    agentInvoked: true,
    degraded: !succeeded,
    degradeReason: succeeded
      ? undefined
      : "binding outputMap didn't expose research/pick — see SceneBinding for relic.draft-metadata",
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
