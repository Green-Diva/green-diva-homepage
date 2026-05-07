import { HandlerKind } from "@prisma/client";
import { httpApi } from "./handlers/httpApi";
import { llmPrompt } from "./handlers/llmPrompt";
import { mcpServer } from "./handlers/mcpServer";
import { internal } from "./handlers/internal";
import type { SkillHandler } from "./types";

export const handlerRegistry: Record<HandlerKind, SkillHandler> = {
  HTTP_API: httpApi,
  LLM_PROMPT: llmPrompt,
  MCP_SERVER: mcpServer,
  INTERNAL: internal,
};
