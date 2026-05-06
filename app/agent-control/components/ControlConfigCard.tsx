"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { AgentRow } from "../types";
import ControlConfigModal from "./ControlConfigModal";

// Replaces the old ControlConfigStrip — taller card that lives at the bottom
// of the Skills column. Mode-aware accent + same modal handoff.
export default function ControlConfigCard({ agent, isAdmin }: { agent: AgentRow; isAdmin: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const isMech = agent.mode === "MECHANICAL";
  const cfg = isMech ? agent.pipelineConfig : agent.dispatcherConfig;
  const isConfigured = !!cfg && Object.keys(cfg).length > 0;

  const accentText = isMech ? "text-secondary" : "text-primary";
  const accentFill = isMech ? "bg-secondary/[0.12]" : "bg-primary/[0.12]";
  const accentBtn = isMech
    ? "border-secondary/70 text-secondary hover:bg-secondary/[0.12]"
    : "border-primary/70 text-primary hover:bg-primary/[0.12]";
  const icon = isMech ? "schema" : "psychology";

  const summary = isConfigured
    ? format(t.agentControl.controlConfigSummary, { n: JSON.stringify(cfg).length })
    : t.agentControl.controlConfigEmpty;

  return (
    <>
      <div
        className={[
          "shrink-0 rounded-md p-3 flex flex-col gap-2",
          accentFill,
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-2">
          <div className={`font-label text-[9px] tracking-[0.3em] uppercase ${accentText}`}>
            {isMech ? "Backbone Config" : "Orchestrator Config"}
          </div>
          <span
            className={`material-symbols-outlined text-[18px] ${accentText}`}
            style={{ fontVariationSettings: "'FILL' 1" }}
            aria-hidden
          >
            {icon}
          </span>
        </div>
        <div className="text-[11px] text-on-surface-variant truncate">
          {summary}
        </div>
        <button
          type="button"
          disabled={!isAdmin}
          onClick={() => setOpen(true)}
          className={[
            "shrink-0 min-h-[34px] w-full px-3 border rounded-md font-label text-[9px] tracking-[0.25em] uppercase transition-colors flex items-center justify-center gap-2",
            accentBtn,
            "disabled:opacity-40 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          <span className="material-symbols-outlined text-[14px]" aria-hidden>
            tune
          </span>
          {t.agentControl.controlConfigEdit}
        </button>
      </div>

      {open ? <ControlConfigModal agent={agent} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
