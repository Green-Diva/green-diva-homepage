"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import type { CapabilitySummary } from "@/lib/agents/capabilityTypes";
import SecretDialog from "./SecretDialog";

type Props = {
  summaries: CapabilitySummary[];
  locale: Locale;
  activeId?: string | null;
  onSelect?: (id: string) => void;
  isAdmin?: boolean;
};

export default function CapabilityList({ summaries, locale, activeId, onSelect, isAdmin }: Props) {
  const t = useT();
  const router = useRouter();
  const enabledCount = summaries.filter((s) => s.envOk).length;
  const isZh = locale === "zh";
  const [editingSecret, setEditingSecret] = useState<string | null>(null);

  const requestClear = async (name: string) => {
    if (!confirm(format(t.machineVision.secretDialogClearConfirm, { name }))) return;
    const r = await fetch(`/api/admin/agent-secrets/${encodeURIComponent(name)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (r.ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-label text-[10px] tracking-[0.3em] text-outline uppercase">
          {t.machineVision.activeCapabilities}
        </h3>
        {summaries.length > 0 ? (
          <span className="font-label text-[9px] tracking-[0.25em] text-on-surface-variant uppercase">
            {format(t.machineVision.activeCapabilitiesSummary, {
              enabled: enabledCount,
              total: summaries.length,
            })}
          </span>
        ) : null}
      </div>

      {summaries.length === 0 ? (
        <p className="text-on-surface-variant text-sm py-4 text-center">
          {t.machineVision.capabilityEmpty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {summaries.map((summary) => (
            <CapabilityRow
              key={summary.id}
              summary={summary}
              isZh={isZh}
              t={t}
              active={summary.id === activeId}
              onSelect={onSelect}
              isAdmin={!!isAdmin}
              onConfigure={(name) => setEditingSecret(name)}
              onClear={requestClear}
            />
          ))}
        </ul>
      )}

      {editingSecret ? (
        <SecretDialog
          name={editingSecret}
          onClose={() => setEditingSecret(null)}
          onSaved={() => {
            setEditingSecret(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CapabilityRow({
  summary,
  isZh,
  t,
  active,
  onSelect,
  isAdmin,
  onConfigure,
  onClear,
}: {
  summary: CapabilitySummary;
  isZh: boolean;
  t: ReturnType<typeof useT>;
  active: boolean;
  onSelect?: (id: string) => void;
  isAdmin: boolean;
  onConfigure: (name: string) => void;
  onClear: (name: string) => void;
}) {
  const meta = summary.metadata;
  const name = isZh ? meta.nameZh : meta.nameEn;
  const altName = isZh ? meta.nameEn : meta.nameZh;
  const description = isZh ? meta.descriptionZh : meta.descriptionEn;

  // Status dot color logic: green if env ok AND no recent failures;
  // amber if env ok but last call failed; grey if env not configured.
  const ledClass = !summary.envOk
    ? "bg-on-surface-variant/40"
    : summary.stats.last?.ok === false
      ? "bg-secondary shadow-[0_0_6px_currentColor] text-secondary"
      : "bg-primary shadow-[0_0_6px_currentColor] text-primary";

  const successRate =
    summary.stats.total > 0
      ? Math.round((summary.stats.successful / summary.stats.total) * 100)
      : null;

  const interactive = !!onSelect;
  const baseRing = active
    ? "border-primary bg-primary/[0.05] shadow-[inset_0_0_0_1px_rgba(144,222,205,0.4)]"
    : summary.envOk
      ? "border-outline-variant/40 hover:border-primary/40"
      : "border-outline-variant/30 opacity-75 hover:opacity-100";

  return (
    <li
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onSelect!(summary.id) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect!(summary.id);
              }
            }
          : undefined
      }
      className={
        "relative border bg-background/40 p-3 sm:p-3.5 transition-colors " +
        baseRing +
        (interactive ? " cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" : "")
      }
    >
      <div className="flex gap-3">
        <span
          className="material-symbols-outlined text-primary/70 text-[26px] shrink-0 mt-0.5"
          style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}
          aria-hidden
        >
          {meta.iconKey}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={"w-2 h-2 rounded-full " + ledClass} aria-hidden />
            <span className="text-on-surface text-sm font-medium leading-tight">{name}</span>
            <span className="font-label text-[9px] tracking-[0.25em] text-on-surface-variant/70 uppercase">
              {altName}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-on-surface-variant leading-relaxed line-clamp-2">
            {description}
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap font-label text-[9px] tracking-[0.2em] uppercase">
            <span className="px-1.5 py-0.5 border border-outline-variant/40 text-on-surface-variant/80">
              {meta.provider}
            </span>
            <span className="px-1.5 py-0.5 border border-outline-variant/40 text-on-surface-variant/80 font-mono normal-case tracking-normal">
              {summary.id}
            </span>
            {!summary.envOk ? (
              isAdmin && summary.missingEnvVars.length > 0 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfigure(summary.missingEnvVars[0]);
                  }}
                  title={summary.missingEnvVars.join(", ")}
                  className="px-1.5 py-0.5 border border-secondary/60 text-secondary hover:bg-secondary/10 normal-case tracking-normal font-mono"
                >
                  {t.machineVision.secretConfigure} · {summary.missingEnvVars[0]}
                </button>
              ) : (
                <span
                  className="px-1.5 py-0.5 border border-secondary/40 text-secondary normal-case tracking-normal font-mono"
                  title={summary.missingEnvVars.join(", ")}
                >
                  {format(t.machineVision.capabilityRequiresEnv, {
                    vars: summary.missingEnvVars.join(", "),
                  })}
                </span>
              )
            ) : summary.stats.total === 0 ? (
              <span className="text-on-surface-variant/60 normal-case tracking-normal">
                {t.machineVision.capabilityNoCalls}
              </span>
            ) : (
              <>
                <span className="text-on-surface-variant/80 normal-case tracking-normal">
                  {format(t.machineVision.capabilityRecentSummary, {
                    count: summary.stats.total,
                    successRate: successRate ?? 0,
                  })}
                </span>
                {summary.stats.avgLatencyMs != null ? (
                  <span className="text-on-surface-variant/60 normal-case tracking-normal">
                    {format(t.machineVision.capabilityAvgLatency, {
                      ms: summary.stats.avgLatencyMs,
                    })}
                  </span>
                ) : null}
              </>
            )}
            {isAdmin && summary.envOk
              ? meta.requiredEnvVars.map((envName) => (
                  <span key={envName} className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfigure(envName);
                      }}
                      title={envName}
                      className="px-1.5 py-0.5 border border-outline-variant/40 text-on-surface-variant/80 hover:border-primary/60 hover:text-primary normal-case tracking-normal font-mono"
                    >
                      {t.machineVision.secretReconfigure} · {envName}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClear(envName);
                      }}
                      title={envName}
                      className="px-1.5 py-0.5 border border-outline-variant/40 text-on-surface-variant/60 hover:border-error/60 hover:text-error normal-case tracking-normal font-mono"
                    >
                      {t.machineVision.secretClear}
                    </button>
                  </span>
                ))
              : null}
          </div>
        </div>
      </div>
    </li>
  );
}
