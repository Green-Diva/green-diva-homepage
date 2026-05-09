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
import { relicImagePick } from "./relicImagePick";
import { meshy3d } from "./meshy3d";
import { geminiResearcher } from "./geminiResearcher";
import { smartImagePicker } from "./smartImagePicker";
import { falCutout } from "./falCutout";

const internalHandlers: Record<string, SkillHandler> = {
  "relic-files-summary": relicFilesSummary,
  // Legacy v1 picker — kept for backward compat with any agent still wired
  // to it; new flows use relic-smart-image-pick instead.
  "relic-image-pick": relicImagePick,
  "meshy-3d": meshy3d,
  // Phase 5+ handlers (lore/multimodal flow):
  "relic-gemini-researcher": geminiResearcher,
  "relic-smart-image-pick": smartImagePicker,
  "relic-cutout": falCutout,
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
