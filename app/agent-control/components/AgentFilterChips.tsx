"use client";

import { useT } from "@/lib/i18n/client";
import type { AgentMode } from "../types";
import { themeClass } from "@/lib/agentControl/theme";

export type ModeFilter = "ALL" | AgentMode;

export default function AgentFilterChips({
  value,
  onChange,
  counts,
}: {
  value: ModeFilter;
  onChange: (v: ModeFilter) => void;
  counts: { all: number; machines: number; agents: number };
}) {
  const t = useT();
  const chips: Array<{ key: ModeFilter; label: string; count: number; tone: string }> = [
    { key: "ALL", label: t.agentControl.filterAll, count: counts.all, tone: "primary" },
    { key: "MECHANICAL", label: t.agentControl.filterMachines, count: counts.machines, tone: "secondary" },
    { key: "AUTONOMOUS", label: t.agentControl.filterAgents, count: counts.agents, tone: "primary" },
  ];

  return (
    <div role="tablist" aria-label="filter" className="flex items-center gap-1.5 flex-wrap">
      {chips.map((c) => {
        const active = value === c.key;
        const toneActive = themeClass(
          c.tone === "secondary" ? "MECHANICAL" : "AUTONOMOUS",
          "chipActive",
        );
        return (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(c.key)}
            className={[
              "min-h-[34px] px-3 rounded-full border font-label text-[10px] tracking-[0.25em] uppercase transition-colors flex items-center gap-2",
              active
                ? toneActive
                : "border-outline-variant/40 text-on-surface-variant hover:border-primary/40 hover:text-primary touch:border-primary/40 touch:text-primary",
            ].join(" ")}
          >
            <span>{c.label}</span>
            <span
              className={`tabular-nums text-[9px] opacity-70 ${active ? "" : "text-on-surface-variant"}`}
              aria-hidden
            >
              {c.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
