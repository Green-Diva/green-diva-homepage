"use client";

import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { EquipRow, AgentMode } from "../types";

const STATUS_BADGE: Record<string, string> = {
  ONLINE: "text-emerald-300 border-emerald-400/50 bg-emerald-400/[0.10]",
  OFFLINE: "text-on-surface-variant/80 border-on-surface-variant/30 bg-on-surface-variant/[0.06]",
};

type Props = {
  slotIndex: number;
  equip: EquipRow | null;
  mode: AgentMode;
  onClick: () => void;
  disabled?: boolean;
};

export default function SkillDetailCard({ slotIndex, equip, mode, onClick, disabled }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const isMech = mode === "MECHANICAL";

  const accentFill = isMech ? "bg-secondary/[0.12]" : "bg-primary/[0.12]";
  const accentText = isMech ? "text-secondary" : "text-primary";
  const accentHover = isMech
    ? "hover:bg-secondary/[0.20]"
    : "hover:bg-primary/[0.20]";

  const slotLabel = format(t.machineAgent.skillSlotLabel, { n: slotIndex + 1 });

  if (!equip) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={[
          "w-full flex-1 min-h-0 rounded-md bg-on-surface/[0.04]",
          "flex items-center gap-2 px-2 py-1.5 text-left transition-colors",
          "hover:bg-on-surface/[0.08] disabled:opacity-50 disabled:cursor-not-allowed",
        ].join(" ")}
        aria-label={`${slotLabel} · ${t.machineAgent.skillSlotEmpty}`}
      >
        <span
          className="material-symbols-outlined text-[18px] text-on-surface-variant/50 leading-none shrink-0"
          aria-hidden
        >
          add
        </span>
        <span className="font-label text-[9px] tracking-[0.2em] text-on-surface-variant/70 uppercase truncate">
          {slotLabel} · {t.machineAgent.skillSlotEmpty}
        </span>
      </button>
    );
  }

  const skill = equip.skill;
  const skillName = locale === "zh" ? skill.nameZh : skill.nameEn;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "w-full flex-1 min-h-0 rounded-md transition-all",
        accentFill,
        accentHover,
        "flex items-center gap-2 px-2 py-1.5 text-left disabled:opacity-50 disabled:cursor-not-allowed",
      ].join(" ")}
      aria-label={`${slotLabel} · ${skillName}`}
      title={`${slotLabel} · ${skillName}`}
    >
      <span
        className={`material-symbols-outlined text-[20px] leading-none shrink-0 ${accentText}`}
        style={{ fontVariationSettings: "'FILL' 1" }}
        aria-hidden
      >
        {skill.icon}
      </span>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1.5 font-label text-[8px] tracking-[0.2em] uppercase">
          <span className={accentText}>{slotLabel}</span>
          <span className="text-on-surface-variant/60">·</span>
          <span className="text-on-surface-variant">{format(t.machineAgent.skillLevel, { n: skill.level })}</span>
          <span
            className={`border rounded-sm px-1 py-px font-label text-[7px] tracking-[0.15em] uppercase ${STATUS_BADGE[skill.status] ?? ""}`}
          >
            {skill.status}
          </span>
        </div>
        <div className="text-[11px] text-on-surface font-medium truncate leading-tight mt-0.5">
          {skillName}
        </div>
      </div>
    </button>
  );
}
