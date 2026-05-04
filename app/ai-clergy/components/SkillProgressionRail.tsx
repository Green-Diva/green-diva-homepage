"use client";

import type { CapabilitySummary } from "@/lib/clerics/capabilityTypes";
import { STATE_TOKENS, statusOf } from "./capabilityState";

type Props = {
  summaries: CapabilitySummary[];
  activeId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

const TOTAL_SLOTS = 6;

export default function SkillProgressionRail({
  summaries,
  activeId,
  hoveredId,
  onSelect,
  onHover,
}: Props) {
  // Walk left → right; the pipeline "breaks" at the first warning slot.
  // Slots themselves always show their own status colour (green/yellow);
  // the green progress line is what reflects the pipeline-readiness chain.
  const firstWarning = summaries.findIndex((c) => statusOf(c) === "warning");
  const allReady = summaries.length > 0 && firstWarning === -1;
  const lineEndIndex = firstWarning === -1 ? summaries.length - 1 : firstWarning - 1;

  // Slot center as % of container width (6-col grid, no gap consideration).
  const slotCenterPct = (i: number) => ((i + 0.5) / TOTAL_SLOTS) * 100;
  const lineStartPct = slotCenterPct(0);
  const lineFullEndPct = slotCenterPct(TOTAL_SLOTS - 1);
  const lineGreenEndPct = lineEndIndex >= 0 ? slotCenterPct(lineEndIndex) : lineStartPct;

  return (
    <div className="relative px-2 py-3">
      {/* Baseline grey rail spanning all 6 slot centers */}
      <div
        aria-hidden
        className="absolute top-[58%] -translate-y-1/2 h-px bg-outline-variant/50"
        style={{ left: `${lineStartPct}%`, width: `${lineFullEndPct - lineStartPct}%` }}
      />
      {/* Green fill from slot 0 up to last continuously-ready slot */}
      {lineEndIndex >= 1 ? (
        <div
          aria-hidden
          className="absolute top-[58%] -translate-y-1/2 h-px bg-emerald-400"
          style={{
            left: `${lineStartPct}%`,
            width: `${lineGreenEndPct - lineStartPct}%`,
            boxShadow: "0 0 6px rgba(52,211,153,0.7)",
          }}
        />
      ) : null}
      {/* Break indicator: small yellow dot just before the first warning slot */}
      {firstWarning > 0 ? (
        <div
          aria-hidden
          className="absolute top-[58%] -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-300 shadow-[0_0_4px_rgba(252,211,77,0.8)]"
          style={{ left: `calc(${slotCenterPct(firstWarning)}% - 3px)` }}
        />
      ) : null}

      <div className="relative grid grid-cols-6 gap-2 sm:gap-3 items-end">
        {Array.from({ length: TOTAL_SLOTS }).map((_, i) => {
          if (i >= summaries.length) {
            return <LockSlot key={`lock-${i}`} index={i} />;
          }
          const cap = summaries[i];
          const state = statusOf(cap);
          const tokens = STATE_TOKENS[state];
          const isActive = cap.id === activeId;
          const isHovered = cap.id === hoveredId;
          return (
            <button
              key={cap.id}
              type="button"
              onClick={() => onSelect(cap.id)}
              onMouseEnter={() => onHover(cap.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(cap.id)}
              onBlur={() => onHover(null)}
              aria-pressed={isActive}
              aria-label={cap.metadata.nameEn}
              title={`${cap.metadata.nameEn} / ${cap.metadata.nameZh}`}
              className="group flex flex-col items-center gap-2 min-h-[44px] focus:outline-none"
            >
              <span className={`font-label text-[10px] tracking-[0.3em] transition-colors ${tokens.text}`}>
                LV.{i + 1}
              </span>
              <span
                className={[
                  "relative flex items-center justify-center rounded-md border w-11 h-11",
                  "transition-all duration-200",
                  tokens.border,
                  tokens.bgTint,
                  // Hover from either panel: scale + brighten via inner ring
                  isHovered ? "scale-110 ring-1 ring-primary/40" : "",
                  // Active: stronger primary halo on top of state colour
                  isActive ? "mv-skill-active ring-2 ring-primary/70" : "",
                ].join(" ")}
              >
                <span className={`material-symbols-outlined text-xl ${tokens.text}`} aria-hidden>
                  {cap.metadata.iconKey}
                </span>
                <span
                  aria-hidden
                  className={[
                    "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full",
                    tokens.led,
                    state === "ready" && allReady ? "animate-pulse" : "",
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

function LockSlot({ index }: { index: number }) {
  return (
    <div className="flex flex-col items-center gap-2 min-h-[44px] opacity-50" aria-hidden>
      <span className="font-label text-[10px] tracking-[0.3em] text-outline">LV.{index + 1}</span>
      <span className="relative flex items-center justify-center rounded-md border w-11 h-11 border-outline-variant/50 bg-surface-container">
        <span className="material-symbols-outlined text-xl text-outline" aria-hidden>
          lock
        </span>
      </span>
    </div>
  );
}
