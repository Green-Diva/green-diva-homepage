// MCP_SERVER handler — placeholder for Phase 5. Skills using this kind
// will throw until the MCP client integration ships.

import { HandlerError, type SkillHandler } from "../types";

export const mcpServer: SkillHandler = async () => {
  throw new HandlerError(
    "MCP_SERVER handler not yet implemented (Phase 5)",
    "INVALID_CONFIG",
  );
};
