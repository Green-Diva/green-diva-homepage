"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { AgentRow } from "../types";
import ControlConfigModal from "./ControlConfigModal";

export default function ControlConfigStrip({ agent, isAdmin }: { agent: AgentRow; isAdmin: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const isMech = agent.mode === "MECHANICAL";
  const cfg = isMech ? agent.pipelineConfig : agent.dispatcherConfig;
  const isConfigured = !!cfg && Object.keys(cfg).length > 0;
  const accent = isMech ? "text-secondary" : "text-primary";
  const border = isMech ? "border-secondary/30" : "border-primary/30";
  const buttonBorder = isMech ? "border-secondary/60" : "border-primary/60";
  const buttonText = isMech ? "text-secondary" : "text-primary";

  const summary = isConfigured
    ? format(t.machineAgent.controlConfigSummary, { n: JSON.stringify(cfg).length })
    : t.machineAgent.controlConfigEmpty;

  return (
    <div className={`shrink-0 flex items-center justify-between gap-3 border-t ${border} pt-2`}>
      <div className="min-w-0 flex-1">
        <div className={`font-label text-[9px] tracking-[0.3em] uppercase ${accent}`}>
          {t.machineAgent.controlConfigTitle}
        </div>
        <div className="text-xs text-on-surface-variant truncate">
          {summary}
        </div>
      </div>
      <button
        type="button"
        disabled={!isAdmin}
        onClick={() => setOpen(true)}
        className={`shrink-0 min-h-[36px] px-4 border ${buttonBorder} ${buttonText} font-label text-[10px] tracking-[0.25em] uppercase rounded-md hover:bg-primary/10 disabled:opacity-40 transition-colors flex items-center gap-2`}
      >
        <span className="material-symbols-outlined text-[16px]" aria-hidden>
          {isMech ? "schema" : "psychology"}
        </span>
        {t.machineAgent.controlConfigEdit}
      </button>

      {open ? <ControlConfigModal agent={agent} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
