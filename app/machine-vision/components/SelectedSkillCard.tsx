"use client";

import type { AgentSkill } from "@/lib/agentTypes";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

const KIND_KEY: Record<AgentSkill["kind"], "passiveSkill" | "activeSkill" | "ultimateSkill"> = {
  PASSIVE: "passiveSkill",
  ACTIVE: "activeSkill",
  ULTIMATE: "ultimateSkill",
};

export default function SelectedSkillCard({
  skill,
  isAdmin,
}: {
  skill: AgentSkill | null;
  isAdmin: boolean;
}) {
  const t = useT();

  if (!skill) {
    return (
      <div className="flex flex-col gap-3">
        <div className="font-label text-[10px] tracking-[0.3em] text-outline uppercase">
          {t.machineVision.selectedSkill}
        </div>
        <p className="text-on-surface-variant text-sm">{t.machineVision.skillEmpty}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="font-label text-[10px] tracking-[0.3em] text-outline uppercase">
        {t.machineVision.selectedSkill}
      </div>
      <h3 className="font-headline text-2xl text-primary leading-tight tracking-wide">
        <span className="uppercase">{skill.nameEn}</span>
        <span className="text-on-surface text-base ml-3">/ {skill.nameZh}</span>
      </h3>
      <div className="flex flex-wrap gap-2">
        <span className="px-2.5 py-1 border border-outline-variant text-on-surface-variant font-label text-[9px] tracking-[0.25em] uppercase rounded-sm bg-surface-container">
          {t.machineVision[KIND_KEY[skill.kind]]}
        </span>
        <span className="px-2.5 py-1 border border-secondary/40 text-secondary font-label text-[9px] tracking-[0.25em] uppercase rounded-sm bg-secondary/[0.08]">
          {format(t.machineVision.cost, { n: skill.costAp })}
        </span>
        {!skill.unlocked ? (
          <span className="px-2.5 py-1 border border-outline-variant/50 text-outline font-label text-[9px] tracking-[0.25em] uppercase rounded-sm bg-surface-container/40">
            {t.machineVision.locked}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
        <div className="flex-1 space-y-3">
          <p className="text-on-surface text-sm leading-relaxed">{skill.descriptionZh}</p>
          <p className="text-on-surface-variant text-xs leading-relaxed opacity-80">{skill.descriptionEn}</p>
        </div>
        <div className="hidden sm:flex shrink-0 w-24 h-24 self-center rounded-full border border-primary/25 items-center justify-center relative">
          <div aria-hidden className="absolute inset-0 rounded-full border border-primary/10 scale-110" />
          <div aria-hidden className="absolute inset-0 rounded-full border border-primary/5 scale-125" />
          <span className="material-symbols-outlined text-5xl text-primary/70" aria-hidden>
            {skill.icon}
          </span>
        </div>
      </div>

      <div className="pt-4 mt-2 border-t border-outline-variant/30 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!isAdmin}
          className="min-h-[44px] px-4 py-2 border border-outline-variant text-on-surface font-label text-[10px] tracking-[0.3em] uppercase rounded-sm hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {t.machineVision.reset}
        </button>
        <button
          type="button"
          disabled={!isAdmin}
          className="min-h-[44px] px-4 py-2 border border-outline-variant text-on-surface font-label text-[10px] tracking-[0.3em] uppercase rounded-sm hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {t.machineVision.clear}
        </button>
        <button
          type="button"
          disabled={!isAdmin}
          className="flex-1 min-h-[44px] px-4 py-2 font-label text-[10px] tracking-[0.3em] uppercase rounded-sm bg-gradient-to-r from-primary to-secondary text-background font-bold disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
        >
          <span>{t.machineVision.confirmAllocation}</span>
          <span className="material-symbols-outlined text-base" aria-hidden>
            add_circle
          </span>
        </button>
      </div>
    </div>
  );
}
