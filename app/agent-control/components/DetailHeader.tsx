"use client";

import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { AgentRow, EquipRow } from "../types";
import { themeClass } from "@/lib/agentControl/theme";
import TestRunButton from "./TestRunButton";

// New header (post-redesign): no avatar — that's now the Hero portrait below.
// One row of: codename + mode badge + deploy badge + EDIT button + INVOCATIONS button.
// Subtitle row: localized name · deployedAt.
export default function DetailHeader({
  agent,
  equips,
  isAdmin,
  onEdit,
  onShowJobs,
  dimNonEdit,
}: {
  agent: AgentRow;
  equips: EquipRow[];
  isAdmin: boolean;
  onEdit: () => void;
  onShowJobs?: () => void;
  // True when agent.status === OFFLINE — every sibling button (JOBS,
  // TEST RUN, badges, subtitle) gets greyscale + pointer-events-none.
  // EDIT stays clickable so admin can flip the agent back online.
  dimNonEdit?: boolean;
}) {
  const t = useT();
  const { locale } = useI18n();

  const isMech = agent.mode === "MECHANICAL";
  const accentText = themeClass(agent.mode, "text");
  const anyOnline = equips.some((e) => e.skill.status === "ONLINE");
  const modeBadge = !anyOnline
    ? "border-on-surface-variant/40 text-on-surface-variant/80 bg-on-surface-variant/[0.06]"
    : themeClass(agent.mode, "modeBadge");
  // Lifecycle badge mirrors agent.status (the roster column reads the same
  // field). After 2026-05-15, status is the single source of truth: STANDBY
  // ↔ deployedAt=null, DEPLOYED ↔ deployedAt set. OFFLINE is admin's manual
  // kill switch (deployedAt may still be set; intent untouched).
  const deployBadge =
    agent.status === "DEPLOYED"
      ? "border-emerald-400/50 text-emerald-300 bg-emerald-400/[0.08]"
      : agent.status === "OFFLINE"
        ? "border-rose-400/50 text-rose-300 bg-rose-400/[0.08]"
        : "border-amber-300/50 text-amber-200 bg-amber-300/[0.08]";

  const modeLabel = isMech ? t.agentControl.modeMechanical : t.agentControl.modeAutonomous;
  const deployLabel =
    agent.status === "DEPLOYED"
      ? t.agentControl.statusDeployed
      : agent.status === "OFFLINE"
        ? t.agentControl.statusOffline
        : t.agentControl.statusStandby;

  const subtitleName = locale === "zh" ? agent.nameZh : agent.nameEn;
  const deployedWhen = agent.deployedAt
    ? format(t.agentControl.deployedAt, { when: new Date(agent.deployedAt).toLocaleString(locale) })
    : null;

  const dimSibling = dimNonEdit ? "opacity-50 grayscale pointer-events-none" : "";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className={`font-headline text-2xl ${accentText} sacred-glow leading-tight truncate ${dimSibling}`}>
          {agent.codename}
        </h2>
        <span className={`font-label text-[9px] tracking-[0.3em] uppercase border rounded px-1.5 py-0.5 ${modeBadge} ${dimSibling}`}>
          {modeLabel}
        </span>
        {/* Lifecycle badge is NOT dimmed when offline — it's the OFFLINE
            indicator itself (red), so it stays vivid as the visual cue. */}
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
            {t.agentControl.edit}
          </button>
        ) : null}
        <div className={`flex items-center gap-2 ${dimSibling}`}>
          {onShowJobs ? (
            <button
              type="button"
              onClick={onShowJobs}
              title="Invocations"
              aria-label="Invocations"
              className="min-h-[30px] px-2.5 border border-outline-variant text-on-surface-variant font-label text-[9px] tracking-[0.25em] uppercase rounded-md hover:bg-surface-container hover:text-on-surface transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden>terminal</span>
              JOBS
            </button>
          ) : null}
          <TestRunButton agent={agent} isAdmin={isAdmin} />
        </div>
      </div>
      <div className={`font-label text-[11px] tracking-[0.18em] text-on-surface-variant truncate mt-0.5 ${dimSibling}`}>
        {subtitleName}
        {deployedWhen ? (
          <span className="ml-2 text-on-surface-variant/70 normal-case">{deployedWhen}</span>
        ) : null}
      </div>
    </div>
  );
}
