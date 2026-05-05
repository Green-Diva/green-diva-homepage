"use client";

import { useT } from "@/lib/i18n/client";
import type { AgentMode } from "../types";
import type { CentralPos } from "@/lib/machineAgent/slotPositions";

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
  const accent = isMech
    ? "border-secondary text-secondary"
    : "border-primary text-primary";
  const glow = isMech ? "rgba(233,193,118,0.55)" : "rgba(144,222,205,0.55)";
  const icon = isMech ? "schema" : "psychology";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={t.machineAgent.skillCentralSlotLabel}
      title={isMech ? t.machineAgent.pipelineConfigTitle : t.machineAgent.dispatcherConfigTitle}
      className={[
        "absolute -translate-x-1/2 -translate-y-1/2 rounded-md flex flex-col items-center justify-center backdrop-blur-md transition-all hover:scale-110 disabled:cursor-not-allowed",
        "w-[58px] h-[58px] border-2 bg-background/80",
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
        {t.machineAgent.skillCentralSlotLabel}
      </span>
    </button>
  );
}
