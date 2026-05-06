"use client";

import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { EquipRow, AgentMode } from "../types";
import type { SlotPos } from "@/lib/agentControl/slotPositions";

type Props = {
  pos: SlotPos;
  equip: EquipRow | null;
  mode: AgentMode;
  onClick: () => void;
  disabled?: boolean;
};

export default function SkillSlot({ pos, equip, mode, onClick, disabled }: Props) {
  const t = useT();
  const isMech = mode === "MECHANICAL";
  const ringActive = isMech ? "border-secondary text-secondary" : "border-primary text-primary";
  const ringEmpty = isMech
    ? "border-secondary/35 hover:border-secondary/70 text-secondary/60"
    : "border-primary/35 hover:border-primary/70 text-primary/60";
  const glow = isMech ? "rgba(233,193,118,0.45)" : "rgba(144,222,205,0.45)";

  const label = equip
    ? equip.skill.icon
    : "+";

  const ariaLabel = equip
    ? `${t.agentControl.skillSlotDetailTitle} · ${equip.skill.nameEn}`
    : `${format(t.agentControl.skillSlotLabel, { n: pos.i + 1 })} · ${t.agentControl.skillSlotEmpty}`;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={[
        "absolute -translate-x-1/2 -translate-y-1/2 w-[44px] h-[44px] rounded-md flex items-center justify-center backdrop-blur-sm transition-all touch:scale-100 hover:scale-110 disabled:cursor-not-allowed",
        equip
          ? `border bg-background/70 ${ringActive}`
          : `border border-dashed bg-background/40 ${ringEmpty}`,
      ].join(" ")}
      style={{
        top: pos.top,
        left: pos.left,
        boxShadow: equip ? `0 0 14px ${glow}, inset 0 0 6px ${glow}` : undefined,
      }}
    >
      {equip ? (
        <span
          className="material-symbols-outlined text-[22px] leading-none"
          style={{ fontVariationSettings: "'FILL' 1" }}
          aria-hidden
        >
          {label}
        </span>
      ) : (
        <span className="font-label text-[16px] leading-none" aria-hidden>
          {label}
        </span>
      )}
      <span
        aria-hidden
        className={`absolute -top-2 -right-1 font-label text-[8px] tracking-[0.15em] px-1 rounded-sm ${
          equip ? (isMech ? "bg-secondary/20 text-secondary" : "bg-primary/20 text-primary") : "bg-surface-container text-on-surface-variant"
        }`}
      >
        {pos.i + 1}
      </span>
    </button>
  );
}
