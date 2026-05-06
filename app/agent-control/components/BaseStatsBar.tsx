"use client";

import { useT } from "@/lib/i18n/client";
import type { AgentRow } from "../types";
import { MACHINE_AGENT_STAT_KEYS, type AgentStatKey } from "@/lib/agentTypes";

const ROW_LABELS: Record<AgentStatKey, { label: keyof ReturnType<typeof useT>["machineAgent"]; hint: keyof ReturnType<typeof useT>["machineAgent"] }> = {
  chaosLevel: { label: "statChaos", hint: "statChaosHint" },
  costTier: { label: "statCost", hint: "statCostHint" },
  activityLevel: { label: "statActivity", hint: "statActivityHint" },
  stabilityLevel: { label: "statStability", hint: "statStabilityHint" },
};

export default function BaseStatsBar({ agent }: { agent: AgentRow }) {
  const t = useT();
  const isMech = agent.mode === "MECHANICAL";
  const accentColor = isMech ? "rgba(233,193,118,0.7)" : "rgba(144,222,205,0.7)";
  const accentBar = isMech ? "bg-secondary" : "bg-primary";
  const accentText = isMech ? "text-secondary" : "text-primary";
  const accentBorder = isMech ? "border-secondary/25" : "border-primary/25";
  const accentMarker = isMech ? "before:bg-secondary/70 after:bg-secondary/70" : "before:bg-primary/70 after:bg-primary/70";

  // To revert: replace the outer wrapper back to `<div className="shrink-0 space-y-2">`
  // and drop the title-tab + corner markers.
  return (
    <div
      className={[
        "shrink-0 relative rounded-md border bg-background/50 px-4 pt-3.5 pb-3",
        accentBorder,
      ].join(" ")}
    >
      {/* Top-left "BASE_STATS" tab cut into the border */}
      <div
        className={[
          "absolute -top-2 left-3 px-2 leading-none font-label text-[10px] tracking-[0.3em] uppercase bg-background",
          accentText,
        ].join(" ")}
      >
        {t.machineAgent.baseStats}
      </div>
      {/* Corner markers (top-right + bottom-left) — mode-coloured ticks */}
      <span
        aria-hidden
        className={[
          "absolute top-0 right-0 w-3 h-3 pointer-events-none",
          "before:content-[''] before:absolute before:top-0 before:right-0 before:h-px before:w-full",
          "after:content-[''] after:absolute after:top-0 after:right-0 after:w-px after:h-full",
          accentMarker,
        ].join(" ")}
      />
      <span
        aria-hidden
        className={[
          "absolute bottom-0 left-0 w-3 h-3 pointer-events-none",
          "before:content-[''] before:absolute before:bottom-0 before:left-0 before:h-px before:w-full",
          "after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-px after:h-full",
          accentMarker,
        ].join(" ")}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2">
        {MACHINE_AGENT_STAT_KEYS.map((key) => {
          const value = (agent[key] as number) ?? 0;
          const meta = ROW_LABELS[key];
          return (
            <div key={key} title={t.machineAgent[meta.hint]}>
              <div className="flex items-baseline justify-between font-label text-[9px] tracking-[0.18em] uppercase">
                <span className="text-on-surface-variant truncate">{t.machineAgent[meta.label]}</span>
                <span className={accentText}>
                  <span className="tabular-nums">{value}</span>
                  <span className="text-on-surface-variant/60">%</span>
                </span>
              </div>
              <div className="mt-1 h-1 w-full bg-surface-container rounded-sm overflow-hidden border border-outline-variant/30">
                <div
                  className={`h-full ${accentBar} rounded-sm transition-[width]`}
                  style={{
                    width: `${Math.min(100, Math.max(0, value))}%`,
                    boxShadow: `0 0 6px ${accentColor}`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {/* TODO: derive these stats from AgentSkillEquip + invocation history */}
    </div>
  );
}
