"use client";

import { useState } from "react";
import Image from "next/image";
import { useT } from "@/lib/i18n/client";
import type { AgentRow, EquipRow, SkillRow } from "../types";
import { getLoadoutLayout } from "@/lib/machineAgent/slotPositions";
import SkillSlot from "./SkillSlot";
import CentralControlSlot from "./CentralControlSlot";
import SkillPickerModal from "./SkillPickerModal";
import SkillSlotDetailModal from "./SkillSlotDetailModal";
import ControlConfigModal from "./ControlConfigModal";

type Props = {
  agent: AgentRow;
  equips: EquipRow[];
  allSkills: SkillRow[];
  isAdmin: boolean;
};

export default function EquipmentLoadout({ agent, equips, allSkills, isAdmin }: Props) {
  const t = useT();
  const layout = getLoadoutLayout(agent.mode);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [detailEquip, setDetailEquip] = useState<EquipRow | null>(null);
  const [controlOpen, setControlOpen] = useState(false);
  const [bgError, setBgError] = useState(false);

  // slotted equips, indexed by slotIndex
  const slotted = new Map<number, EquipRow>();
  for (const e of equips) {
    if (typeof e.slotIndex === "number" && e.slotIndex >= 0 && e.slotIndex < layout.slots.length) {
      slotted.set(e.slotIndex, e);
    }
  }

  const isMech = agent.mode === "MECHANICAL";
  const tintClass = isMech ? "from-secondary/20" : "from-primary/20";
  const configured = isMech
    ? !!agent.pipelineConfig && Object.keys(agent.pipelineConfig).length > 0
    : !!agent.dispatcherConfig && Object.keys(agent.dispatcherConfig).length > 0;

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-2">
      <div className="relative h-full max-h-full aspect-[3/4] mx-auto">
        {/* Background image — falls back to embedded SVG if jpg missing */}
        <Image
          src={bgError ? layout.fallback : layout.background}
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-contain opacity-85 pointer-events-none select-none"
          onError={() => setBgError(true)}
          unoptimized={bgError}
        />

        {/* Tint + scanline overlays */}
        <div aria-hidden className={`absolute inset-0 pointer-events-none bg-gradient-to-t ${tintClass} via-transparent to-background/30 mix-blend-screen`} />
        <div aria-hidden className="absolute inset-0 pointer-events-none scanline-overlay opacity-40" />

        {/* Slot label header */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between font-label text-[9px] tracking-[0.3em] uppercase opacity-80 pointer-events-none">
          <span className={isMech ? "text-secondary" : "text-primary"}>{isMech ? "M-LOADOUT · 06" : "A-LOADOUT · 06"}</span>
          <span className="text-on-surface-variant">{slotted.size}/{layout.slots.length}</span>
        </div>

        {/* 6 skill slots */}
        {layout.slots.map((pos) => {
          const equip = slotted.get(pos.i) ?? null;
          return (
            <SkillSlot
              key={pos.i}
              pos={pos}
              equip={equip}
              mode={agent.mode}
              disabled={!isAdmin}
              onClick={() => {
                if (!isAdmin) return;
                if (equip) setDetailEquip(equip);
                else setPickerSlot(pos.i);
              }}
            />
          );
        })}

        {/* Central control slot */}
        <CentralControlSlot
          pos={layout.central}
          mode={agent.mode}
          configured={configured}
          disabled={!isAdmin}
          onClick={() => setControlOpen(true)}
        />
      </div>

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

      {controlOpen ? (
        <ControlConfigModal
          agent={agent}
          onClose={() => setControlOpen(false)}
        />
      ) : null}

      {/* Suppress unused t warning when nothing else uses it (and gives skill panel a usable prop). */}
      <span aria-hidden className="sr-only">{t.machineAgent.skillCentralSlotLabel}</span>
    </div>
  );
}
