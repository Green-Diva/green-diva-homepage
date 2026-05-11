import { AgentErrorCode } from "@/lib/agent-errors";
import { MAX_LOOP_DEPTH } from "../types";
import type {
  ExecutorCtx,
  ForEachNode,
  NodeExecResult,
} from "../types";

// Runs body sub-DAG once per item in the inputFrom-resolved array.
// Body sees `agent.input = { item, index, total }`. Counts toward
// MAX_LOOP_DEPTH (forEach + loop share the recursion budget).
export async function executeForEachNode(
  node: ForEachNode,
  ctx: ExecutorCtx,
): Promise<NodeExecResult> {
  if (ctx.depth >= MAX_LOOP_DEPTH) {
    const rawMsg = `forEach "${node.id}" exceeds MAX_LOOP_DEPTH=${MAX_LOOP_DEPTH}`;
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
  const inputArr = ctx.resolveRef(node.inputFrom);
  if (!Array.isArray(inputArr)) {
    const rawMsg = `forEach "${node.id}".inputFrom must resolve to an array, got ${typeof inputArr}`;
    const now = new Date();
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationMs: 0,
      ok: false,
      errorCode: "FOREACH_INPUT_NOT_ARRAY",
      errorMessage: rawMsg,
    });
    return {
      ok: false,
      errorCode: "FOREACH_INPUT_NOT_ARRAY",
      errorMessage: `node "${node.id}": ${rawMsg}`,
    };
  }

  const items = inputArr.slice(0, node.maxItems);
  const truncated = inputArr.length > node.maxItems;
  const aggregateMode = node.aggregate ?? "concat-array";
  const aggregated: unknown[] = [];
  let lastOutput: unknown = undefined;
  let aborted = false;
  let abortCode: AgentErrorCode = AgentErrorCode.AGENT_RUNTIME_ERROR;
  let abortMessage = "";
  let processed = 0;

  for (let i = 0; i < items.length; i++) {
    const sub = await ctx.runSubDag({
      input: { item: items[i], index: i, total: items.length },
      body: { version: 2, nodes: node.body.nodes, edges: node.body.edges },
      stepIdPrefix: `${ctx.stepIdPrefix}${node.id}#${i + 1}/`,
    });
    if (!sub.ok) {
      aborted = true;
      abortCode = sub.errorCode;
      abortMessage = `forEach "${node.id}" item ${i}: ${sub.errorMessage}`;
      break;
    }
    processed = i + 1;
    lastOutput = sub.output;
    if (aggregateMode === "concat-array" && Array.isArray(sub.output)) {
      aggregated.push(...sub.output);
    } else {
      aggregated.push(sub.output);
    }
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
      output: { processed, totalItems: items.length, partialAggregate: aggregated },
    });
    return { ok: false, errorCode: abortCode, errorMessage: abortMessage };
  }
  const finalOut = aggregateMode === "concat-array" ? aggregated : lastOutput;
  ctx.runLog.push({
    stepId: ctx.stepIdPrefix + node.id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startMs,
    ok: true,
    output: { processed, totalItems: items.length, truncated, finalOutput: finalOut },
  });
  await ctx.emitProgress();
  return { ok: true, output: finalOut };
}
