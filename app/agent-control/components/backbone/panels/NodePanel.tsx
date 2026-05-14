"use client";

import type { EquipRow } from "../../../types";
import type {
  BranchNodeData,
  FlowNode,
  ForEachNodeData,
  LoopNodeData,
  NodeData,
  PersistNodeData,
  SkillNodeData,
  TransformNodeData,
} from "../types";
import { SkillNodePanel } from "./SkillNodePanel";
import { BranchNodePanel } from "./BranchNodePanel";
import { LoopNodePanel } from "./LoopNodePanel";
import { ForEachNodePanel } from "./ForEachNodePanel";
import { TransformNodePanel } from "./TransformNodePanel";
import { PersistNodePanel } from "./PersistNodePanel";

export function NodePanel({
  node,
  allNodes,
  equipBySlot,
  onPatch,
  onRename,
  onOpenLoopBody,
}: {
  node: FlowNode;
  allNodes: FlowNode[];
  equipBySlot: Map<number, EquipRow>;
  onPatch: (patch: Partial<NodeData>) => void;
  onRename: (newId: string) => void;
  // null => disable the "Edit loop body" button (used inside the body
  // editor itself, where loop nodes can't appear anyway — defensive).
  onOpenLoopBody: ((nodeId: string) => void) | null;
}) {
  const otherNodeIds = allNodes.map((n) => n.id).filter((id) => id !== node.id);
  const sourceOptions = ["agent.input", ...otherNodeIds.map((id) => `${id}.output`)];

  return (
    <div className="space-y-3">
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary mb-1">
          Node ID
        </div>
        <input
          defaultValue={node.id}
          onBlur={(e) => onRename(e.target.value.trim())}
          className="w-full bg-background/60 border border-secondary/30 px-2 py-1 text-[12px] text-on-surface"
        />
      </div>

      {node.data.type === "skill" ? (
        <SkillNodePanel
          data={node.data}
          equipBySlot={equipBySlot}
          sourceOptions={sourceOptions}
          onPatch={onPatch as (p: Partial<SkillNodeData>) => void}
        />
      ) : node.data.type === "branch" ? (
        <BranchNodePanel
          data={node.data}
          sourceOptions={sourceOptions}
          onPatch={onPatch as (p: Partial<BranchNodeData>) => void}
        />
      ) : node.data.type === "loop" ? (
        <LoopNodePanel
          data={node.data}
          equipBySlot={equipBySlot}
          sourceOptions={sourceOptions}
          onPatch={onPatch as (p: Partial<LoopNodeData>) => void}
          onOpenBody={onOpenLoopBody ? () => onOpenLoopBody(node.id) : null}
        />
      ) : node.data.type === "forEach" ? (
        <ForEachNodePanel
          data={node.data}
          equipBySlot={equipBySlot}
          sourceOptions={sourceOptions}
          onPatch={onPatch as (p: Partial<ForEachNodeData>) => void}
          onOpenBody={onOpenLoopBody ? () => onOpenLoopBody(node.id) : null}
        />
      ) : node.data.type === "transform" ? (
        <TransformNodePanel
          data={node.data}
          sourceOptions={sourceOptions}
          onPatch={onPatch as (p: Partial<TransformNodeData>) => void}
        />
      ) : (
        <PersistNodePanel
          data={node.data}
          sourceOptions={sourceOptions}
          onPatch={onPatch as (p: Partial<PersistNodeData>) => void}
        />
      )}
    </div>
  );
}
