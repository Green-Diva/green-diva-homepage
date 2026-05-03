"use client";

import type { AgentSkill } from "@/lib/agentTypes";
import type { SkillLevel } from "../types";

type Props = {
  skills: AgentSkill[];
  activeLevel: SkillLevel;
  onSelect: (level: SkillLevel) => void;
};

const LEVELS: SkillLevel[] = [1, 2, 3, 4, 5, 6];

export default function SkillProgressionRail({ skills, activeLevel, onSelect }: Props) {
  const byLevel = new Map<SkillLevel, AgentSkill>();
  for (const s of skills) byLevel.set(s.level, s);

  const unlockedSet = new Set<SkillLevel>();
  for (const s of skills) if (s.unlocked) unlockedSet.add(s.level);

  const lastUnlocked = Math.max(0, ...Array.from(unlockedSet));
  const progress = Math.max(0, Math.min(1, (lastUnlocked - 1) / (LEVELS.length - 1)));

  return (
    <div className="relative px-2 py-3">
      <div aria-hidden className="absolute left-7 right-7 top-[58%] -translate-y-1/2 h-px bg-outline-variant/50" />
      <div
        aria-hidden
        className="absolute left-7 top-[58%] -translate-y-1/2 h-px bg-primary"
        style={{
          width: `calc(${progress * 100}% - ${progress * 56}px + ${progress > 0 ? 4 : 0}px)`,
          maxWidth: "calc(100% - 56px)",
          boxShadow: "0 0 6px rgba(144,222,205,0.6)",
        }}
      />
      <div className="relative grid grid-cols-6 gap-2 sm:gap-3 items-end">
        {LEVELS.map((lv) => {
          const skill = byLevel.get(lv);
          const unlocked = !!skill?.unlocked;
          const active = lv === activeLevel;
          const dim = !skill || (!unlocked && !active);
          return (
            <button
              key={lv}
              type="button"
              onClick={() => onSelect(lv)}
              aria-pressed={active}
              className="flex flex-col items-center gap-2 min-h-[44px] focus:outline-none"
            >
              <span
                className={`font-label text-[10px] tracking-[0.3em] ${
                  active ? "text-primary" : unlocked ? "text-secondary" : "text-outline"
                }`}
              >
                LV.{lv}
              </span>
              <span
                className={[
                  "relative flex items-center justify-center rounded-md border w-11 h-11",
                  active
                    ? "border-primary bg-primary/[0.18] mv-skill-active"
                    : unlocked
                      ? "border-secondary/60 bg-secondary/[0.06]"
                      : "border-outline-variant/50 bg-surface-container",
                  dim ? "opacity-50" : "opacity-100",
                  "transition-all",
                ].join(" ")}
              >
                <span
                  className={`material-symbols-outlined text-xl ${
                    active ? "text-primary" : unlocked ? "text-secondary" : "text-outline"
                  }`}
                  aria-hidden
                >
                  {skill?.icon ?? "lock"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
