"use client";

import type { EquipRow } from "../../../types";
import type { BodyNodeData } from "../types";

// Surfaces the body's skill nodes in the loop / forEach side panel using the
// same "Slot N · SkillName" formatting as SkillNodePanel's EQUIP SLOT
// dropdown, so admins can see which skills the body uses without having to
// open the sub-canvas.
export function BodySkillsList({
  bodyNodes,
  equipBySlot,
  accent,
}: {
  bodyNodes: BodyNodeData[];
  equipBySlot: Map<number, EquipRow>;
  // Header tint — sky-400 for forEach, violet-300 for loop. Matches the
  // surrounding panel's accent palette so the section reads as part of the
  // body editor, not the skill editor.
  accent: string;
}) {
  const skills = bodyNodes.flatMap((n) =>
    n.type === "skill" ? [{ slotIndex: n.slotIndex, nodeId: n.nodeId }] : [],
  );
  if (skills.length === 0) return null;
  return (
    <div>
      <div
        className="font-label text-[9px] tracking-[0.3em] uppercase mb-1"
        style={{ color: accent }}
      >
        Body Equip Slots
      </div>
      <ul className="space-y-1">
        {skills.map(({ slotIndex, nodeId }, i) => {
          const eq = equipBySlot.get(slotIndex);
          return (
            <li
              key={`${nodeId}-${i}`}
              className="flex items-baseline gap-2 bg-background/60 border px-2 py-1 text-[12px] text-on-surface"
              style={{ borderColor: `${accent.replace("rgb(", "rgba(").replace(")", " / 0.3)")}` }}
            >
              <span className="font-label text-[10px] tracking-[0.2em] shrink-0" style={{ color: accent }}>
                Slot {slotIndex + 1}
              </span>
              <span className="text-on-surface-variant/60">·</span>
              <span className="truncate">{eq ? eq.skill.nameEn : "(empty)"}</span>
              <span className="ml-auto font-mono text-[10px] text-on-surface-variant/60 shrink-0">
                {nodeId}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
