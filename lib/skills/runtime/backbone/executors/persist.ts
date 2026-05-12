// persist executor — runtime data-persistence primitive.
//
// Calls lib/relics/persistAsset.ts in-process (no HTTP round trip). Logs
// success as `{ output: { savedPath, absPath, bytes, contentType } }`;
// failure surfaces as PERSIST_INPUT_INVALID (Zod validation) or
// PERSIST_FAILED (write / base64 / path traversal). The runner's
// `_relicWriteback` hook is unrelated — agents that need column-level
// writeback wire a transform node after persist to compose the envelope.

import { persistRelicAsset, PersistAssetError } from "@/lib/relics/persistAsset";
import type { AgentErrorCode } from "@/lib/agent-errors";
import type {
  ExecutorCtx,
  NodeExecResult,
  PersistNode,
} from "../types";

export async function executePersistNode(
  node: PersistNode,
  ctx: ExecutorCtx,
): Promise<NodeExecResult> {
  const startedAt = new Date();
  const startMs = Date.now();
  const input = ctx.resolveRef(node.inputFrom);
  try {
    const output = await persistRelicAsset(input);
    const endedAt = new Date();
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startMs,
      ok: true,
      output,
    });
    await ctx.emitProgress();
    return { ok: true, output };
  } catch (e) {
    const code: AgentErrorCode =
      e instanceof PersistAssetError && e.code === "INPUT_INVALID"
        ? "PERSIST_INPUT_INVALID"
        : "PERSIST_FAILED";
    const message = e instanceof Error ? e.message : String(e);
    const now = new Date();
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationMs: Date.now() - startMs,
      ok: false,
      errorCode: code,
      errorMessage: message,
      output: input,
    });
    await ctx.emitProgress();
    return {
      ok: false,
      errorCode: code,
      errorMessage: `node "${node.id}": ${message}`,
    };
  }
}
