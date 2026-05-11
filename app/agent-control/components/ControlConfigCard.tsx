"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { AgentRow, EquipRow } from "../types";
import BackboneFlowEditor from "./BackboneFlowEditor";
import OrchestratorEditor from "./OrchestratorEditor";
import { themeClass } from "@/lib/agentControl/theme";

// Replaces the old ControlConfigStrip — taller card that lives at the bottom
// of the Skills column. Mode-aware accent.
//
// Edit dispatch:
//   MECHANICAL → BackboneEditor (Phase 3 structured editor)
//   AUTONOMOUS → OrchestratorEditor (Phase 4 LLM tool-use loop editor)
//
// Both editors need `equips` to render slot/tool previews.
export default function ControlConfigCard({
  agent,
  isAdmin,
  equips,
}: {
  agent: AgentRow;
  isAdmin: boolean;
  equips: EquipRow[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const isMech = agent.mode === "MECHANICAL";
  const cfg = isMech ? agent.pipelineConfig : agent.dispatcherConfig;
  const isConfigured = !!cfg && Object.keys(cfg).length > 0;

  const accentText = themeClass(agent.mode, "text");
  const accentFill = themeClass(agent.mode, "fill");
  const accentBtn = themeClass(agent.mode, "btnAccent");
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

      {open ? (
        isMech ? (
          <BackboneFlowEditor agent={agent} equips={equips} onClose={() => setOpen(false)} />
        ) : (
          <OrchestratorEditor agent={agent} equips={equips} onClose={() => setOpen(false)} />
        )
      ) : null}
    </>
  );
}
