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
  const accent = isMech ? "secondary" : "primary";
  const accentColor = isMech ? "rgba(233,193,118,0.7)" : "rgba(144,222,205,0.7)";
  const accentBar = isMech ? "bg-secondary" : "bg-primary";
  const accentText = isMech ? "text-secondary" : "text-primary";

  return (
    <div className="shrink-0 space-y-2">
      <div className="flex items-center justify-between">
        <div className={`font-label text-[10px] tracking-[0.3em] ${accentText} uppercase`}>{t.machineAgent.baseStats}</div>
        <span className="material-symbols-outlined text-outline text-base" aria-hidden>
          bar_chart
        </span>
      </div>
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
      <span aria-hidden className={`font-label text-[8px] tracking-[0.25em] ${accent === "secondary" ? "text-secondary/40" : "text-primary/40"} uppercase block`}>
        ⏳ pending derivation
      </span>
    </div>
  );
}
