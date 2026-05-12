// Per-node executor dispatch.
//
// The topo loop in runBackbone calls executors[node.type](node, ctx)
// (with the branch case threading outgoing labels). Each executor is
// responsible for its own log entries + onProgress emission; the loop
// just consumes NodeExecResult to update outputs / liveNodes / liveEdges.

import { executeSkillNode } from "./skill";
import { executeBranchNode } from "./branch";
import { executeLoopNode } from "./loop";
import { executeForEachNode } from "./forEach";
import { executeTransformNode } from "./transform";
import { executePersistNode } from "./persist";

export {
  executeSkillNode,
  executeBranchNode,
  executeLoopNode,
  executeForEachNode,
  executeTransformNode,
  executePersistNode,
};
