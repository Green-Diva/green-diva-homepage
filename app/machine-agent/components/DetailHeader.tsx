"use client";

import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { AgentRow } from "../types";

export default function DetailHeader({ agent }: { agent: AgentRow }) {
  const t = useT();
  const { locale } = useI18n();

  const isMech = agent.mode === "MECHANICAL";
  const modeLabel = isMech ? t.machineAgent.modeMechanical : t.machineAgent.modeAutonomous;
  const accent = isMech ? "secondary" : "primary";
  const ringClass = isMech ? "border-secondary/60" : "border-primary/60";
  const modeBadgeClass = isMech
    ? "border-secondary/60 text-secondary bg-secondary/[0.10]"
    : "border-primary/60 text-primary bg-primary/[0.10]";
  const deployBadge = agent.deployedAt
    ? {
        label: t.machineAgent.deployStatusDeployed,
        cls: "border-emerald-400/50 text-emerald-300 bg-emerald-400/[0.08]",
      }
    : {
        label: t.machineAgent.deployStatusDraft,
        cls: "border-amber-300/50 text-amber-200 bg-amber-300/[0.08]",
      };

  const deployedWhen = agent.deployedAt
    ? format(t.machineAgent.deployedAt, { when: new Date(agent.deployedAt).toLocaleString(locale) })
    : null;

  return (
    <div className="flex items-center gap-4 shrink-0">
      <div className={`relative shrink-0 w-16 h-16 rounded-full border ${ringClass} overflow-hidden bg-surface-container-lowest`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={agent.avatarUrl}
          alt={agent.codename}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
        <span aria-hidden className="absolute inset-0 scanline-overlay opacity-60" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-headline text-2xl text-${accent} sacred-glow leading-tight truncate`}>{agent.codename}</span>
          <span className={`font-label text-[9px] tracking-[0.3em] uppercase border rounded px-1.5 py-0.5 ${modeBadgeClass}`}>{modeLabel}</span>
          <span className={`font-label text-[9px] tracking-[0.3em] uppercase border rounded px-1.5 py-0.5 ${deployBadge.cls}`}>{deployBadge.label}</span>
        </div>
        <div className="font-label text-[11px] tracking-[0.18em] text-on-surface-variant truncate mt-0.5">
          {locale === "zh" ? agent.nameZh : agent.nameEn}
          {agent.classification ? <span className="text-secondary/70"> · {agent.classification}</span> : null}
        </div>
        {deployedWhen ? (
          <div className="font-label text-[9px] tracking-[0.2em] text-on-surface-variant/80 uppercase mt-0.5">
            {deployedWhen}
          </div>
        ) : null}
      </div>
    </div>
  );
}
