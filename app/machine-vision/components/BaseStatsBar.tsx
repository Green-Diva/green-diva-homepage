"use client";

import { useT } from "@/lib/i18n/client";
import type { AgentRow } from "../types";

const ROWS: Array<{ key: keyof AgentRow & string; label: keyof ReturnType<typeof useT>["machineVision"] }> = [
  { key: "quickness", label: "statQuickness" },
  { key: "intelligence", label: "statIntelligence" },
  { key: "neuralLink", label: "statNeuralLink" },
  { key: "bioSync", label: "statBioSync" },
];

export default function BaseStatsBar({ agent }: { agent: AgentRow }) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">{t.machineVision.baseStats}</div>
        <span className="material-symbols-outlined text-outline text-base" aria-hidden>
          bar_chart
        </span>
      </div>
      <div className="space-y-2.5">
        {ROWS.map(({ key, label }) => {
          const value = agent[key] as number;
          const isHigh = value >= 90;
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between font-label text-[10px] tracking-[0.2em]">
                <span className="text-on-surface-variant uppercase">{t.machineVision[label]}</span>
                <span className={isHigh ? "text-primary" : "text-secondary"}>
                  <span className="tabular-nums">{value}</span>
                  <span className="text-on-surface-variant">/100</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full bg-surface-container rounded-sm overflow-hidden border border-outline-variant/40">
                <div
                  className={`h-full ${isHigh ? "bg-primary" : "bg-secondary"} rounded-sm`}
                  style={{
                    width: `${Math.min(100, Math.max(0, value))}%`,
                    boxShadow: `0 0 8px ${isHigh ? "rgba(144,222,205,0.45)" : "rgba(233,193,118,0.45)"}`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
