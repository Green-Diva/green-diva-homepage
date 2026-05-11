"use client";

import { useT } from "@/lib/i18n/client";
import type { AgentMode } from "../types";
import type { CentralPos } from "@/lib/agentControl/slotPositions";
import { themeClass, themeRgba } from "@/lib/agentControl/theme";

type Props = {
  pos: CentralPos;
  mode: AgentMode;
  configured: boolean;
  onClick: () => void;
  disabled?: boolean;
};

export default function CentralControlSlot({ pos, mode, configured, onClick, disabled }: Props) {
  const t = useT();
  const isMech = mode === "MECHANICAL";
  const accent = themeClass(mode, "ring");
  const glow = themeRgba(mode, "medium");
  const icon = isMech ? "schema" : "psychology";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={t.agentControl.skillCentralSlotLabel}
      title={isMech ? t.agentControl.pipelineConfigTitle : t.agentControl.dispatcherConfigTitle}
      className={[
        "absolute -translate-x-1/2 -translate-y-1/2 rounded-md flex flex-col items-center justify-center backdrop-blur-md transition-all hover:scale-110 disabled:cursor-not-allowed",
        "w-[72px] h-[72px] border-2 bg-background/80 px-1",
        accent,
        configured ? "" : "border-dashed",
      ].join(" ")}
      style={{
        top: pos.top,
        left: pos.left,
        boxShadow: `0 0 18px ${glow}, inset 0 0 8px ${glow}`,
      }}
    >
      <span aria-hidden className="material-symbols-outlined text-[24px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
        {icon}
      </span>
      <span aria-hidden className="font-label text-[7px] tracking-[0.25em] uppercase mt-0.5">
        {isMech ? "Backbone" : "Orchestrator"}
      </span>
    </button>
  );
}
