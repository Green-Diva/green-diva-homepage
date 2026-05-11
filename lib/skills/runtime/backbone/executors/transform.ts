import jsonata from "jsonata";
import type {
  ExecutorCtx,
  NodeExecResult,
  TransformNode,
} from "../types";

export async function executeTransformNode(
  node: TransformNode,
  ctx: ExecutorCtx,
): Promise<NodeExecResult> {
  const startedAt = new Date();
  const startMs = Date.now();
  const transformInput = ctx.resolveRef(node.inputFrom);
  let transformOutput: unknown;
  try {
    const expr = jsonata(node.expression);
    transformOutput = await expr.evaluate(transformInput);
  } catch (e) {
    const rawMsg = `transform "${node.id}" evaluation failed: ${e instanceof Error ? e.message : String(e)}`;
    const now = new Date();
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationMs: 0,
      ok: false,
      errorCode: "TRANSFORM_FAILED",
      errorMessage: rawMsg,
      output: transformInput,
    });
    return {
      ok: false,
      errorCode: "TRANSFORM_FAILED",
      errorMessage: `node "${node.id}": ${rawMsg}`,
    };
  }
  const endedAt = new Date();
  ctx.runLog.push({
    stepId: ctx.stepIdPrefix + node.id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startMs,
    ok: true,
    output: transformOutput,
  });
  await ctx.emitProgress();
  return { ok: true, output: transformOutput };
}
