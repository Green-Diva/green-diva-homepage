"use client";

import type { AgentRow } from "../types";
import { useT } from "@/lib/i18n/client";
import { themeClass } from "@/lib/agentControl/theme";

const STATUS_STYLES: Record<AgentRow["status"], { dot: string; label: keyof ReturnType<typeof useT>["agentControl"] }> = {
  ONLINE: { dot: "bg-emerald-400", label: "statusOnline" },
  STANDBY: { dot: "bg-amber-300", label: "statusStandby" },
  OFFLINE: { dot: "bg-rose-400", label: "statusOffline" },
};

const MODE_ICON: Record<AgentRow["mode"], { icon: string; key: "modeMechanical" | "modeAutonomous" }> = {
  MECHANICAL: { icon: "precision_manufacturing", key: "modeMechanical" },
  AUTONOMOUS: { icon: "hub", key: "modeAutonomous" },
};

export default function AgentListItem({
  agent,
  active,
  onSelect,
}: {
  agent: AgentRow;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const status = STATUS_STYLES[agent.status];
  const label = t.agentControl[status.label] as string;
  const mode = MODE_ICON[agent.mode ?? "MECHANICAL"];

  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      aria-pressed={active}
      className={[
        "group w-full text-left rounded-md border transition-all min-h-[60px] px-3 py-2 flex items-center gap-3 relative overflow-hidden",
        active
          ? "border-primary/60 bg-primary/[0.07]"
          : "border-primary/10 bg-surface-container/40 hover:border-primary/30 hover:bg-primary/[0.04] touch:border-primary/30 touch:bg-primary/[0.04]",
      ].join(" ")}
    >
      {active ? (
        <span aria-hidden className="absolute right-0 top-0 bottom-0 w-[2px] bg-primary shadow-[0_0_10px_rgba(144,222,205,0.7)]" />
      ) : null}
      <div className="relative shrink-0">
        {agent.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agent.avatarUrl}
            alt={agent.codename}
            loading="lazy"
            decoding="async"
            className={[
              "w-11 h-11 rounded-full object-cover border",
              active ? "border-primary" : "border-outline-variant grayscale group-hover:grayscale-0",
            ].join(" ")}
          />
        ) : (
          <div
            className={[
              "w-11 h-11 rounded-full border flex items-center justify-center bg-surface-container",
              active ? "border-primary text-primary" : "border-outline-variant text-outline",
            ].join(" ")}
            aria-hidden
          >
            <span className="material-symbols-outlined text-xl">smart_toy</span>
          </div>
        )}
        <span
          aria-hidden
          className={`absolute -bottom-[1px] -right-[1px] w-2.5 h-2.5 rounded-full border border-background ${status.dot} ${agent.status === "ONLINE" ? "mv-status-dot" : ""}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`font-label text-[11px] tracking-[0.2em] flex items-center gap-1.5 ${active ? "text-primary" : "text-on-surface"}`}>
          <span
            aria-hidden
            className={`material-symbols-outlined text-[11px] leading-none ${themeClass(agent.mode ?? "MECHANICAL", "text")}`}
            title={t.agentControl[mode.key] as string}
          >
            {mode.icon}
          </span>
          {agent.codename}
        </div>
        <div className="font-label text-[10px] tracking-[0.18em] text-on-surface-variant truncate">
          {agent.nameZh} · {agent.nameEn}
        </div>
      </div>
      <span
        className={`font-label text-[9px] tracking-[0.25em] uppercase ${
          agent.status === "ONLINE" ? "text-emerald-400" : agent.status === "STANDBY" ? "text-amber-200" : "text-rose-300"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
