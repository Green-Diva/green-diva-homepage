"use client";

import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { AgentRow } from "../types";

// New header (post-redesign): no avatar — that's now the Hero portrait below.
// One row of: codename + mode badge + deploy badge + EDIT button.
// Subtitle row: localized name · classification · deployedAt.
export default function DetailHeader({
  agent,
  isAdmin,
  onEdit,
}: {
  agent: AgentRow;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const { locale } = useI18n();

  const isMech = agent.mode === "MECHANICAL";
  const accentText = isMech ? "text-secondary" : "text-primary";
  const modeBadge = isMech
    ? "border-secondary/60 text-secondary bg-secondary/[0.10]"
    : "border-primary/60 text-primary bg-primary/[0.10]";
  const deployBadge = agent.deployedAt
    ? "border-emerald-400/50 text-emerald-300 bg-emerald-400/[0.08]"
    : "border-amber-300/50 text-amber-200 bg-amber-300/[0.08]";

  const modeLabel = isMech ? t.machineAgent.modeMechanical : t.machineAgent.modeAutonomous;
  const deployLabel = agent.deployedAt ? t.machineAgent.deployStatusDeployed : t.machineAgent.deployStatusDraft;

  const subtitleName = locale === "zh" ? agent.nameZh : agent.nameEn;
  const deployedWhen = agent.deployedAt
    ? format(t.machineAgent.deployedAt, { when: new Date(agent.deployedAt).toLocaleString(locale) })
    : null;

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className={`font-headline text-2xl ${accentText} sacred-glow leading-tight truncate`}>
          {agent.codename}
        </h2>
        <span className={`font-label text-[9px] tracking-[0.3em] uppercase border rounded px-1.5 py-0.5 ${modeBadge}`}>
          {modeLabel}
        </span>
        <span className={`font-label text-[9px] tracking-[0.3em] uppercase border rounded px-1.5 py-0.5 ${deployBadge}`}>
          {deployLabel}
        </span>
        {isAdmin ? (
          <button
            type="button"
            onClick={onEdit}
            className="ml-1 min-h-[30px] px-2.5 border border-outline-variant text-on-surface-variant font-label text-[9px] tracking-[0.25em] uppercase rounded-md hover:bg-surface-container hover:text-on-surface transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden>edit</span>
            {t.machineAgent.edit}
          </button>
        ) : null}
      </div>
      <div className="font-label text-[11px] tracking-[0.18em] text-on-surface-variant truncate mt-0.5">
        {subtitleName}
        {agent.classification ? <span className="text-secondary/70"> · {agent.classification}</span> : null}
        {deployedWhen ? (
          <span className="ml-2 text-on-surface-variant/70 normal-case">{deployedWhen}</span>
        ) : null}
      </div>
    </div>
  );
}
