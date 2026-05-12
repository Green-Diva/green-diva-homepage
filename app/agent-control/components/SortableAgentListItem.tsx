"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AgentRow } from "../types";
import AgentListItem from "./AgentListItem";

export default function SortableAgentListItem({
  agent,
  active,
  onSelect,
  draggable,
}: {
  agent: AgentRow;
  active: boolean;
  onSelect: (id: string) => void;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: agent.id,
    disabled: !draggable,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: draggable ? (isDragging ? "grabbing" : "grab") : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...(draggable ? listeners : {})}>
      <AgentListItem agent={agent} active={active} onSelect={onSelect} />
    </div>
  );
}
