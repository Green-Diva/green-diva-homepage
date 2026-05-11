"use client";

import type { EquipRow } from "../../../types";
import { SLOT_COUNT, type SkillNodeData } from "../types";
import { InputFromEditor } from "./InputFromEditor";

export function SkillNodePanel({
  data,
  equipBySlot,
  sourceOptions,
  onPatch,
}: {
  data: SkillNodeData;
  equipBySlot: Map<number, EquipRow>;
  sourceOptions: string[];
  onPatch: (patch: Partial<SkillNodeData>) => void;
}) {
  return (
    <>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary mb-1">
          Equip Slot
        </div>
        <select
          value={data.slotIndex}
          onChange={(e) => onPatch({ slotIndex: Number(e.target.value) })}
          className="w-full bg-background/60 border border-secondary/30 px-2 py-1 text-[12px] text-on-surface"
        >
          {Array.from({ length: SLOT_COUNT }).map((_, i) => {
            const eq = equipBySlot.get(i);
            return (
              <option key={i} value={i}>
                Slot {i} · {eq ? eq.skill.nameEn : "(empty)"}
              </option>
            );
          })}
        </select>
      </div>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
    </>
  );
}
