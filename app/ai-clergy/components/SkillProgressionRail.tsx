"use client";

import type { CapabilitySummary } from "@/lib/agents/capabilityTypes";

type Props = {
  summaries: CapabilitySummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

const TOTAL_SLOTS = 6;

export default function SkillProgressionRail({ summaries, activeId, onSelect }: Props) {
  const slots: Array<
    { kind: "cap"; cap: CapabilitySummary; index: number } | { kind: "lock"; index: number }
  > = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (i < summaries.length) slots.push({ kind: "cap", cap: summaries[i], index: i });
    else slots.push({ kind: "lock", index: i });
  }

  // Progress bar reflects how many capabilities are actually ready (env configured).
  const readyCount = summaries.filter((c) => c.envOk).length;
  const progress = Math.max(0, Math.min(1, readyCount / TOTAL_SLOTS));

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
        {slots.map((slot) => {
          if (slot.kind === "lock") {
            return (
              <div
                key={`lock-${slot.index}`}
                className="flex flex-col items-center gap-2 min-h-[44px] opacity-50"
                aria-hidden
              >
                <span className="font-label text-[10px] tracking-[0.3em] text-outline">
                  LV.{slot.index + 1}
                </span>
                <span className="relative flex items-center justify-center rounded-md border w-11 h-11 border-outline-variant/50 bg-surface-container">
                  <span className="material-symbols-outlined text-xl text-outline" aria-hidden>
                    lock
                  </span>
                </span>
              </div>
            );
          }
          const cap = slot.cap;
          const active = cap.id === activeId;
          const ready = cap.envOk;
          const lvLabel = `LV.${slot.index + 1}`;
          return (
            <button
              key={cap.id}
              type="button"
              onClick={() => onSelect(cap.id)}
              aria-pressed={active}
              aria-label={cap.metadata.nameEn}
              title={`${cap.metadata.nameEn} / ${cap.metadata.nameZh}`}
              className="flex flex-col items-center gap-2 min-h-[44px] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span
                className={`font-label text-[10px] tracking-[0.3em] ${
                  active ? "text-primary" : ready ? "text-secondary" : "text-outline"
                }`}
              >
                {lvLabel}
              </span>
              <span
                className={[
                  "relative flex items-center justify-center rounded-md border w-11 h-11 transition-all",
                  active
                    ? "border-primary bg-primary/[0.18] mv-skill-active"
                    : ready
                      ? "border-secondary/60 bg-secondary/[0.06]"
                      : "border-outline-variant/50 bg-surface-container opacity-70",
                ].join(" ")}
              >
                <span
                  className={`material-symbols-outlined text-xl ${
                    active ? "text-primary" : ready ? "text-secondary" : "text-outline"
                  }`}
                  aria-hidden
                >
                  {cap.metadata.iconKey}
                </span>
                <span
                  aria-hidden
                  className={[
                    "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full",
                    ready
                      ? "bg-primary shadow-[0_0_4px_currentColor] text-primary"
                      : "bg-on-surface-variant/50",
                  ].join(" ")}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
