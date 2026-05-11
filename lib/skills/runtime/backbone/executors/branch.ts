import { evalCase } from "../refs";
import type {
  BranchNode,
  ExecutorCtx,
  NodeExecResult,
} from "../types";

// Branch executor — picks a case label, returns `chosenLabel` so the
// dispatcher knows which outgoing edge to mark live. The dispatcher
// also checks that an outgoing edge with `when === chosenLabel` exists
// (validated structurally at validateAndNormalize time, but if admin
// edits the DAG between validate and dispatch the check is cheap).
//
// Output shape `{ branch, value }` matches the original — downstream
// nodes referencing `<branch>.output.value` keep working.
export async function executeBranchNode(
  node: BranchNode,
  ctx: ExecutorCtx,
  outgoingLabels: Set<string>,
): Promise<NodeExecResult> {
  const startedAt = new Date();
  const startMs = Date.now();
  const branchInput = ctx.resolveRef(node.inputFrom);
  let chosenLabel: string | undefined;
  for (const c of node.cases) {
    if (evalCase(branchInput, c)) {
      chosenLabel = c.label;
      break;
    }
  }
  if (!chosenLabel) chosenLabel = node.defaultLabel;

  const now = new Date();
  if (!chosenLabel) {
    const rawMsg = `branch "${node.id}" matched no case and has no defaultLabel`;
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationMs: 0,
      ok: false,
      errorCode: "BRANCH_NO_MATCH",
      errorMessage: rawMsg,
      output: branchInput,
    });
    return {
      ok: false,
      errorCode: "BRANCH_NO_MATCH",
      errorMessage: `node "${node.id}": ${rawMsg}`,
    };
  }
  if (!outgoingLabels.has(chosenLabel)) {
    const rawMsg = `branch "${node.id}" chose "${chosenLabel}" but no outgoing edge has when="${chosenLabel}"`;
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationMs: 0,
      ok: false,
      errorCode: "BRANCH_NO_EDGE",
      errorMessage: rawMsg,
      output: branchInput,
    });
    return {
      ok: false,
      errorCode: "BRANCH_NO_EDGE",
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
    branchLabel: chosenLabel,
    output: branchInput,
  });
  await ctx.emitProgress();
  return {
    ok: true,
    output: { branch: chosenLabel, value: branchInput },
    chosenLabel,
  };
}
