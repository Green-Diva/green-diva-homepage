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
import { smartImagePicker } from "./smartImagePicker";
import { imageToDataUri } from "./imageToDataUri";

const internalHandlers: Record<string, SkillHandler> = {
  // Phase 6: only handlers that genuinely need main-app process access
  // remain. Everything else has been migrated to forge agents
  // (LLM_PROMPT + HTTP_API skills configured per-binding):
  //   - meshy-3d / relic-cutout / relic-image-pick (Phase 5 R1 deleted)
  //   - relic-gemini-researcher → LORE-FORGE-001 (Phase 5 R2 + 6.1 deleted)
  //
  // Pending Phase 6+:
  //   - relic-smart-image-pick: 2-round refinement loop needs a backbone
  //     `loop` primitive before it can be decomposed cleanly
  "relic-files-summary": relicFilesSummary,
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
