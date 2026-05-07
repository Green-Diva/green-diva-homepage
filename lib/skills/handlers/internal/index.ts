// INTERNAL handler — dispatches to an in-repo function by slug.
// Use only when a capability *must* share the main app's runtime
// (Prisma session, auth context, business invariants tied to schema).
// Otherwise prefer HTTP_API or LLM_PROMPT and keep the capability
// expressible as configuration.
//
// Adding a new internal slug = commit to this repo (PR + deploy).
// There is no runtime injection path on purpose.

import { HandlerError, type SkillHandler } from "../../types";

const internalHandlers: Record<string, SkillHandler> = {
  // Phase 1 ships with no entries. Add slugs here as needed.
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
