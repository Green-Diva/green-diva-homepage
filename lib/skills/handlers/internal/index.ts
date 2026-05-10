// INTERNAL handler — dispatches to an in-repo function by slug.
// Use only when a capability *must* share the main app's runtime
// (Prisma session, auth context, business invariants tied to schema).
// Otherwise prefer HTTP_API or LLM_PROMPT and keep the capability
// expressible as configuration.
//
// Adding a new internal slug = commit to this repo (PR + deploy).
// There is no runtime injection path on purpose.

import { HandlerError, type SkillHandler } from "../../types";
import { relicFilesSummary } from "./relicFilesSummary";
import { geminiResearcher } from "./geminiResearcher";
import { smartImagePicker } from "./smartImagePicker";
import { imageToDataUri } from "./imageToDataUri";

const internalHandlers: Record<string, SkillHandler> = {
  "relic-files-summary": relicFilesSummary,
  // Phase 2.4 / Phase 5: the surviving INTERNAL handlers are the ones
  // that genuinely need main-app process access. Everything that used
  // to be INTERNAL-by-default (meshy-3d / relic-cutout / relic-image-pick
  // legacy v1) was migrated to forge agents (HTTP_API + LLM_PROMPT
  // skills) and the originals deleted in migrate-phase5-cleanup.
  //
  // Still here:
  //   - relic-gemini-researcher: pending Phase 5 round 2 (LORE-FORGE-001)
  //   - relic-smart-image-pick: needs backbone DAG `loop` primitive
  //     (Phase 6) before it can be decomposed
  "relic-gemini-researcher": geminiResearcher,
  "relic-smart-image-pick": smartImagePicker,
  // File-IO helper used by all forge agents — minimal surface, no
  // business logic.
  "image-to-data-uri": imageToDataUri,
};

export const internal: SkillHandler = async (input, config, ctx) => {
  const slug = typeof config.handler === "string" ? config.handler : null;
  if (!slug) {
    throw new HandlerError(
      "INTERNAL: handlerConfig.handler (slug) is required",
      "INVALID_CONFIG",
    );
  }
  const fn = internalHandlers[slug];
  if (!fn) {
    throw new HandlerError(
      `INTERNAL: no handler registered for slug "${slug}"`,
      "INVALID_CONFIG",
    );
  }
  return fn(input, config, ctx);
};
