import { AgentErrorCode } from "@/lib/agent-errors";
import { evalCase } from "../refs";
import { MAX_LOOP_DEPTH } from "../types";
import type {
  ExecutorCtx,
  LoopNode,
  NodeExecResult,
} from "../types";

// Runs `body` sub-DAG up to maxIterations times via ctx.runSubDag.
// Each iteration's leaf output becomes the next iteration's input.
// Body trace lands in ctx.runLog (shared with parent DAG) prefixed
// with `<loopId>#<iter>/`; the loop's own summary entry is pushed
// after the iterations finish.
export async function executeLoopNode(
  node: LoopNode,
  ctx: ExecutorCtx,
): Promise<NodeExecResult> {
  if (ctx.depth >= MAX_LOOP_DEPTH) {
    const rawMsg = `loop "${node.id}" exceeds MAX_LOOP_DEPTH=${MAX_LOOP_DEPTH}`;
    const now = new Date();
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationMs: 0,
      ok: false,
      errorCode: "LOOP_TOO_DEEP",
      errorMessage: rawMsg,
    });
    return {
      ok: false,
      errorCode: "LOOP_TOO_DEEP",
      errorMessage: `node "${node.id}": ${rawMsg}`,
    };
  }

  const startedAt = new Date();
  const startMs = Date.now();
  let iterInput = ctx.resolveRef(node.inputFrom);
  let iterOutput: unknown = undefined;
  const aggregated: unknown[] = [];
  const aggregateMode = node.aggregate ?? "last";
  let exitedBy: "exitWhen" | "maxIterations" = "maxIterations";
  let iterCount = 0;
  let aborted = false;
  let abortCode: AgentErrorCode = AgentErrorCode.AGENT_RUNTIME_ERROR;
  let abortMessage = "";

  for (let i = 0; i < node.maxIterations; i++) {
    iterCount = i + 1;
    const sub = await ctx.runSubDag({
      input: iterInput,
      body: { version: 2, nodes: node.body.nodes, edges: node.body.edges },
      stepIdPrefix: `${ctx.stepIdPrefix}${node.id}#${iterCount}/`,
    });
    if (!sub.ok) {
      aborted = true;
      abortCode = sub.errorCode;
      abortMessage = `loop "${node.id}" iter ${iterCount}: ${sub.errorMessage}`;
      break;
    }
    iterOutput = sub.output;
    if (aggregateMode === "concat-array" && Array.isArray(iterOutput)) {
      aggregated.push(...iterOutput);
    } else {
      aggregated.push(iterOutput);
    }
    if (node.exitWhen && node.exitWhen.length > 0) {
      const matched = node.exitWhen.some((c) => evalCase(iterOutput, c));
      if (matched) {
        exitedBy = "exitWhen";
        break;
      }
    }
    iterInput = iterOutput;
  }

  const endedAt = new Date();
  if (aborted) {
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startMs,
      ok: false,
      errorCode: abortCode,
      errorMessage: abortMessage,
      output: { iterations: iterCount, partialAggregate: aggregated },
    });
    return { ok: false, errorCode: abortCode, errorMessage: abortMessage };
  }
  const finalOut = aggregateMode === "concat-array" ? aggregated : iterOutput;
  ctx.runLog.push({
    stepId: ctx.stepIdPrefix + node.id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startMs,
    ok: true,
    output: { iterations: iterCount, exitedBy, finalOutput: finalOut },
  });
  await ctx.emitProgress();
  return { ok: true, output: finalOut };
}
