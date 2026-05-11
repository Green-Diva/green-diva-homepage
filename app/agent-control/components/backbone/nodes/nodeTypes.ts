import { SkillNodeView } from "./SkillNode";
import { BranchNodeView } from "./BranchNode";
import { LoopNodeView } from "./LoopNode";
import { ForEachNodeView } from "./ForEachNode";
import { TransformNodeView } from "./TransformNode";
import { BeginNodeView, EndNodeView, AgentBoundaryView } from "./DecorativeNodes";
import { LabeledEdge } from "./LabeledEdge";

export const nodeTypes = {
  skillNode: SkillNodeView,
  branchNode: BranchNodeView,
  loopNode: LoopNodeView,
  forEachNode: ForEachNodeView,
  transformNode: TransformNodeView,
  beginNode: BeginNodeView,
  endNode: EndNodeView,
  agentBoundaryNode: AgentBoundaryView,
};

export const edgeTypes = { labeled: LabeledEdge };
