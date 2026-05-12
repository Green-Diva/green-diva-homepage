import { SkillNodeView } from "./SkillNode";
import { BranchNodeView } from "./BranchNode";
import { LoopNodeView } from "./LoopNode";
import { ForEachNodeView } from "./ForEachNode";
import { TransformNodeView } from "./TransformNode";
import { PersistNodeView } from "./PersistNode";
import {
  BeginNodeView,
  EndNodeView,
  AgentBoundaryView,
  AgentInputNodeView,
  AgentOutputNodeView,
} from "./DecorativeNodes";
import { LabeledEdge } from "./LabeledEdge";

export const nodeTypes = {
  skillNode: SkillNodeView,
  branchNode: BranchNodeView,
  loopNode: LoopNodeView,
  forEachNode: ForEachNodeView,
  transformNode: TransformNodeView,
  persistNode: PersistNodeView,
  beginNode: BeginNodeView,
  endNode: EndNodeView,
  agentBoundaryNode: AgentBoundaryView,
  agentInputNode: AgentInputNodeView,
  agentOutputNode: AgentOutputNodeView,
};

export const edgeTypes = { labeled: LabeledEdge };
