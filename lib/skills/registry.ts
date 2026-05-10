import { SkillKind } from "@prisma/client";
import { httpApi } from "./handlers/httpApi";
import { llmPrompt } from "./handlers/llmPrompt";
import { mcpServer } from "./handlers/mcpServer";
import type { SkillHandler } from "./types";

// INTERNAL kind retired 2026-05-11 — the last business-orchestrator
// (relic-smart-image-pick) decomposed into PICKER-FORGE-001 using the
// Phase 8 backbone primitives (loop / forEach / transform). Adding new
// in-repo functions is no longer a runtime path; encode the logic as
// HTTP_API + LLM_PROMPT + transform composition.
export const handlerRegistry: Record<SkillKind, SkillHandler> = {
  HTTP_API: httpApi,
  LLM_PROMPT: llmPrompt,
  MCP_SERVER: mcpServer,
};
