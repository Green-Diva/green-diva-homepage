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
import type { Rarity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invokeAgent } from "@/lib/agents/invoke";
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

// Maps the LLM's loose output object onto the Relic columns. Accepts both
// `subtitleZh` (the prompt's user-facing name) and `classifZh` (the DB
// column name) — whichever the model returns. classif* takes precedence
// when both are present.
function shapeMetadata(output: unknown): GenerateMetadataResult["applied"] {
  if (!isObject(output)) {
    return { ...FALLBACK };
  }
  const classifZh = pickString(
    output.classifZh ?? output.subtitleZh,
    FALLBACK.classifZh,
    64,
  );
  const classifEn = pickString(
    output.classifEn ?? output.subtitleEn,
    FALLBACK.classifEn,
    80,
  );
  return {
    iconKey: pickString(output.icon ?? output.iconKey, FALLBACK.iconKey, 64),
    nameZh: pickString(output.titleZh ?? output.nameZh, FALLBACK.nameZh, 48),
    nameEn: pickString(output.titleEn ?? output.nameEn, FALLBACK.nameEn, 80),
    classifZh,
    classifEn,
    rarity: pickRarity(output.rarity),
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
      applied: { ...FALLBACK },
      agentInvoked: false,
    });
  }
  if (!agent.deployedAt) {
    return await applyAndReturn({
      ctx,
      relicSnapshot,
      degraded: true,
      degradeReason: `agent "${SCRIBE_CODENAME}" exists but is not deployed`,
      applied: { ...FALLBACK },
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
      applied: { ...FALLBACK },
      agentInvoked: true,
    });
  }

  if (!runResult.ok) {
    return await applyAndReturn({
      ctx,
      relicSnapshot,
      degraded: true,
      degradeReason: `agent run failed (${runResult.errorCode}): ${runResult.errorMessage}`,
      applied: { ...FALLBACK },
      agentInvoked: true,
    });
  }

  // 3. Shape + write.
  const applied = shapeMetadata(runResult.output);
  return await applyAndReturn({
    ctx,
    relicSnapshot,
    degraded: false,
    applied,
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
}): Promise<StepResult<GenerateMetadataResult>> {
  const { ctx, relicSnapshot, degraded, degradeReason, applied, agentInvoked } = args;

  try {
    await prisma.relic.update({
      where: { id: ctx.relic.id },
      data: {
        iconKey: applied.iconKey,
        nameZh: applied.nameZh,
        nameEn: applied.nameEn,
        classifZh: applied.classifZh,
        classifEn: applied.classifEn,
        rarity: applied.rarity,
      },
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
