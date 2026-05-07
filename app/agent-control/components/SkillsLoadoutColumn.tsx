"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { AgentRow, EquipRow, SkillRow } from "../types";
import SkillDetailCard from "./SkillDetailCard";
import ControlConfigCard from "./ControlConfigCard";
import SkillPickerModal from "./SkillPickerModal";
import SkillSlotDetailModal from "./SkillSlotDetailModal";

const SLOT_INDEXES = [0, 1, 2, 3, 4, 5] as const;

// Right column of the 3-column detail layout: vertical 6 SkillDetailCards
// (one per loadout slot, aligned with the M-loadout slots) + ControlConfigCard.
export default function SkillsLoadoutColumn({
  agent,
  equips,
  allSkills,
  isAdmin,
}: {
  agent: AgentRow;
  equips: EquipRow[];
  allSkills: SkillRow[];
  isAdmin: boolean;
}) {
  const t = useT();
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [detailEquip, setDetailEquip] = useState<EquipRow | null>(null);

  const slottedMap = useMemo(() => {
    const m = new Map<number, EquipRow>();
    for (const e of equips) {
      if (typeof e.slotIndex === "number" && e.slotIndex >= 0 && e.slotIndex < SLOT_INDEXES.length) {
        m.set(e.slotIndex, e);
      }
    }
    return m;
  }, [equips]);

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
      <div className="flex-1 min-h-0 flex flex-col gap-1.5">
        {SLOT_INDEXES.map((i) => {
          const equip = slottedMap.get(i) ?? null;
          return (
            <SkillDetailCard
              key={i}
              slotIndex={i}
              equip={equip}
              mode={agent.mode}
              disabled={!isAdmin}
              onClick={() => {
                if (!isAdmin) return;
                if (equip) setDetailEquip(equip);
                else setPickerSlot(i);
              }}
            />
          );
        })}
      </div>

      <ControlConfigCard agent={agent} isAdmin={isAdmin} equips={equips} />

      {pickerSlot !== null ? (
        <SkillPickerModal
          agentId={agent.id}
          allSkills={allSkills}
          equips={equips}
          targetSlotIndex={pickerSlot}
          mode={agent.mode}
          onClose={() => setPickerSlot(null)}
        />
      ) : null}
      {detailEquip ? (
        <SkillSlotDetailModal
          agentId={agent.id}
          equip={detailEquip}
          mode={agent.mode}
          onClose={() => setDetailEquip(null)}
        />
      ) : null}

      <span aria-hidden className="sr-only">{t.agentControl.skillEquipped}</span>
    </div>
  );
}
