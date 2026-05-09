// Pipeline step: GENERATE_METADATA
//
// Looks up an Agent by codename, invokes it with the current relic's slug,
// and writes the agent's structured output into the Relic row (nameZh/nameEn,
// classifZh/classifEn, iconKey, rarity).
//
// Graceful-degradation policy: this step NEVER fails the pipeline. If the
// scribe agent isn't configured, isn't deployed, or its run fails for any
// reason, we write a "needs curator" placeholder and record a RelicLog
// entry. Reason: metadata is a quality-of-life polish; the relic should
// still reach READY and surface in the vault so an admin can edit it
// manually. Pipeline-level FAILED status is reserved for genuinely broken
// state (corrupt ZIP, disk write failure).

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
// untouched (degrade gracefully) — the agent still succeeds, but formKind
// / primaryImagePath / modelPath stay null until the IDs are restored.
const DAG_NODE_IDS = {
  metadata: "metadata",
  classify: "classify",
  pick2d: "pick2d",
  meshy: "meshy",
} as const;

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
    primaryImagePath: string | null;
    modelPath: string | null;
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
  // Accept loose strings for prompt friendliness ("2D" / "3D" / "two-d").
  if (typeof v === "string") {
    const norm = v.trim().toUpperCase().replace(/[-_\s]/g, "");
    if (norm === "2D" || norm === "TWOD" || norm === "TWO" || norm === "TWOD2D") return "TWO_D";
    if (norm === "3D" || norm === "THREED" || norm === "THREE") return "THREE_D";
  }
  return null;
}

function findNodeOutput(runLog: AgentRunLogEntry[], stepId: string): unknown | undefined {
  // Last successful entry for this step id wins (covers retries).
  for (let i = runLog.length - 1; i >= 0; i -= 1) {
    const e = runLog[i];
    if (e.stepId === stepId && e.ok && !e.skipped) return e.output;
  }
  return undefined;
}

// Builds the writeback payload by merging the agent's final output (metadata
// node, naming/icon/rarity) with per-node outputs picked out of the runLog
// (classify, pick2d, meshy). If a node id is missing the corresponding
// fields stay null and the column isn't touched.
function shapeMetadata(
  finalOutput: unknown,
  runLog: AgentRunLogEntry[],
): GenerateMetadataResult["applied"] {
  // Metadata fields come from the agent's final output (last leaf — usually
  // the metadata skill itself), or the dedicated "metadata" node, whichever
  // produced naming fields.
  const metaSource = (() => {
    if (isObject(finalOutput)) return finalOutput;
    const fromMetadataNode = findNodeOutput(runLog, DAG_NODE_IDS.metadata);
    return isObject(fromMetadataNode) ? fromMetadataNode : null;
  })();
  const meta = metaSource ?? {};
  const classifZh = pickString(
    meta.classifZh ?? meta.subtitleZh,
    FALLBACK.classifZh,
    64,
  );
  const classifEn = pickString(
    meta.classifEn ?? meta.subtitleEn,
    FALLBACK.classifEn,
    80,
  );

  // Visual / classification fields come from the dedicated nodes.
  const classifyOut = findNodeOutput(runLog, DAG_NODE_IDS.classify);
  const formKind = isObject(classifyOut) ? pickFormKind(classifyOut.kind) : null;
  const formReason = isObject(classifyOut)
    ? pickString(classifyOut.reason, "", 500) || null
    : null;

  const pickOut = findNodeOutput(runLog, DAG_NODE_IDS.pick2d);
  const primaryImagePath =
    isObject(pickOut) && typeof pickOut.primaryImagePath === "string"
      ? pickOut.primaryImagePath
      : null;

  const meshyOut = findNodeOutput(runLog, DAG_NODE_IDS.meshy);
  const modelPath =
    isObject(meshyOut) && typeof meshyOut.modelPath === "string"
      ? meshyOut.modelPath
      : null;

  return {
    iconKey: pickString(meta.icon ?? meta.iconKey, FALLBACK.iconKey, 64),
    nameZh: pickString(meta.titleZh ?? meta.nameZh, FALLBACK.nameZh, 48),
    nameEn: pickString(meta.titleEn ?? meta.nameEn, FALLBACK.nameEn, 80),
    classifZh,
    classifEn,
    rarity: pickRarity(meta.rarity),
    formKind,
    formReason,
    primaryImagePath,
    modelPath,
  };
}

const FALLBACK_APPLIED: GenerateMetadataResult["applied"] = {
  ...FALLBACK,
  formKind: null,
  formReason: null,
  primaryImagePath: null,
  modelPath: null,
};

export async function stepGenerateMetadata(
  ctx: PipelineContext,
): Promise<StepResult<GenerateMetadataResult>> {
  const relicSnapshot = {
    id: ctx.relic.id,
    slug: ctx.relic.slug,
    name: ctx.relic.nameEn || ctx.relic.slug,
  };

  // 1. Look up the scribe agent.
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

  // 2. Invoke. invokeAgent returns AgentRunResult (success | failure) — it
  // doesn't throw for run-time failures, only for fundamentally invalid mode.
  let runResult;
  try {
    runResult = await invokeAgent({
      agent,
      mode: agent.mode,
      input: { relicSlug: ctx.relic.slug },
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
    // Partial salvage: even if a downstream node crashed (e.g. meshy 404'd),
    // earlier nodes (classify, pick2d) may have produced usable output. Keep
    // their fields so the relic still gets a form judgment + 2D hero image
    // instead of falling back to a placeholder. Naming fields stay fallback —
    // those come from the metadata node which by definition didn't run.
    const salvaged = shapeMetadata(undefined, runResult.runLog);
    return await applyAndReturn({
      ctx,
      relicSnapshot,
      degraded: true,
      degradeReason: `agent run failed (${runResult.errorCode}): ${runResult.errorMessage}`,
      applied: {
        ...FALLBACK_APPLIED,
        formKind: salvaged.formKind,
        formReason: salvaged.formReason,
        primaryImagePath: salvaged.primaryImagePath,
        modelPath: salvaged.modelPath,
      },
      runLog: runResult.runLog,
      agentInvoked: true,
    });
  }

  // 3. Shape + write.
  const applied = shapeMetadata(runResult.output, runResult.runLog);
  return await applyAndReturn({
    ctx,
    relicSnapshot,
    degraded: false,
    applied,
    agentInvoked: true,
    runLog: runResult.runLog,
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
      // Visual / classification fields. Only write if the agent set them
      // (preserve any prior admin edit when the DAG misses a node).
      ...(applied.formKind !== null ? { formKind: applied.formKind } : {}),
      ...(applied.formReason !== null ? { formReason: applied.formReason } : {}),
      ...(applied.primaryImagePath !== null ? { primaryImagePath: applied.primaryImagePath } : {}),
      ...(applied.modelPath !== null ? { modelPath: applied.modelPath } : {}),
      // Always store the most recent trace so admin can debug.
      pipelineTrace: runLog as unknown as Prisma.InputJsonValue,
    };
    await prisma.relic.update({
      where: { id: ctx.relic.id },
      data: updateData,
    });
  } catch (e) {
    // DB write failure IS a real pipeline failure — surface it.
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
