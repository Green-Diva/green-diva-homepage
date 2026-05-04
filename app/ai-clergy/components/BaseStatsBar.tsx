"use client";

import { useT } from "@/lib/i18n/client";
import type { ClericRow } from "../types";

const ROWS: Array<{ key: keyof ClericRow & string; label: keyof ReturnType<typeof useT>["aiClergy"] }> = [
  { key: "quickness", label: "statQuickness" },
  { key: "intelligence", label: "statIntelligence" },
  { key: "neuralLink", label: "statNeuralLink" },
  { key: "bioSync", label: "statBioSync" },
];

export default function BaseStatsBar({ cleric }: { cleric: ClericRow }) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">{t.aiClergy.baseStats}</div>
        <span className="material-symbols-outlined text-outline text-base" aria-hidden>
          bar_chart
        </span>
      </div>
      <div className="space-y-2.5">
        {ROWS.map(({ key, label }) => {
          const value = cleric[key] as number;
          const isHigh = value >= 90;
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between font-label text-[10px] tracking-[0.2em]">
                <span className="text-on-surface-variant uppercase">{t.aiClergy[label]}</span>
                <span className={isHigh ? "text-emerald-400" : "text-amber-300"}>
                  <span className="tabular-nums">{value}</span>
                  <span className="text-on-surface-variant">/100</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full bg-surface-container rounded-sm overflow-hidden border border-outline-variant/40">
                <div
                  className={`h-full ${isHigh ? "bg-emerald-400" : "bg-amber-300"} rounded-sm`}
                  style={{
                    width: `${Math.min(100, Math.max(0, value))}%`,
                    boxShadow: `0 0 8px ${isHigh ? "rgba(52,211,153,0.45)" : "rgba(252,211,77,0.45)"}`,
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
