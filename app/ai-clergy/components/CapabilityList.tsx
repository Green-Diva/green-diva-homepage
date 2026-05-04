"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import type { CapabilitySummary } from "@/lib/clerics/capabilityTypes";
import SecretDialog from "./SecretDialog";
import { LEVEL_TOKENS } from "./capabilityState";

type Props = {
  summaries: CapabilitySummary[];
  locale: Locale;
  activeId?: string | null;
  hoveredId?: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  isAdmin?: boolean;
};

export default function CapabilityList({
  summaries,
  locale,
  activeId,
  hoveredId,
  onSelect,
  onHover,
  isAdmin,
}: Props) {
  const t = useT();
  const router = useRouter();
  const enabledCount = summaries.filter((s) => s.envOk).length;
  const isZh = locale === "zh";
  const [editingSecret, setEditingSecret] = useState<string | null>(null);

  const requestClear = async (name: string) => {
    if (!confirm(format(t.aiClergy.secretDialogClearConfirm, { name }))) return;
    const r = await fetch(`/api/admin/cleric-secrets/${encodeURIComponent(name)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (r.ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-label text-[10px] tracking-[0.3em] text-outline uppercase">
          {t.aiClergy.activeCapabilities}
        </h3>
        {summaries.length > 0 ? (
          <span className="font-label text-[9px] tracking-[0.25em] text-on-surface-variant uppercase">
            {format(t.aiClergy.activeCapabilitiesSummary, {
              enabled: enabledCount,
              total: summaries.length,
            })}
          </span>
        ) : null}
      </div>

      {summaries.length === 0 ? (
        <p className="text-on-surface-variant text-sm py-4 text-center">
          {t.aiClergy.capabilityEmpty}
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
              hovered={summary.id === hoveredId}
              onSelect={onSelect}
              onHover={onHover}
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
  hovered,
  onSelect,
  onHover,
  isAdmin,
  onConfigure,
  onClear,
}: {
  summary: CapabilitySummary;
  isZh: boolean;
  t: ReturnType<typeof useT>;
  active: boolean;
  hovered: boolean;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  isAdmin: boolean;
  onConfigure: (name: string) => void;
  onClear: (name: string) => void;
}) {
  const meta = summary.metadata;
  const name = isZh ? meta.nameZh : meta.nameEn;
  const description = isZh ? meta.descriptionZh : meta.descriptionEn;

  // Card visual identity is driven by autonomy LEVEL (rarity colour), not by
  // status. Status leaks into the Configure-key button (rose when missing).
  const tokens = LEVEL_TOKENS[meta.autonomyLevel];
  const liRef = useRef<HTMLLIElement>(null);

  // Smooth-scroll into view when this card becomes active (e.g. via rail click).
  useEffect(() => {
    if (active && liRef.current) {
      liRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [active]);

  const successRate =
    summary.stats.total > 0
      ? Math.round((summary.stats.successful / summary.stats.total) * 100)
      : null;

  const interactive = !!onSelect;

  // Layered visual driven by LEVEL tokens (rarity palette):
  //   - left edge: 4px level-coloured strip
  //   - card bg: faint level tint always; brightens slightly on hover
  //   - card border: level-soft default, level-bright on hover, primary teal on active
  const ringClass = active
    ? `border-primary ${tokens.bgTint} shadow-[inset_0_0_0_1px_rgba(144,222,205,0.45)]`
    : hovered
      ? `${tokens.border} ${tokens.bgTint}`
      : `${tokens.borderSoft} ${tokens.bgTintSoft}`;

  return (
    <li
      ref={liRef}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onSelect!(summary.id) : undefined}
      onMouseEnter={() => onHover?.(summary.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(summary.id)}
      onBlur={() => onHover?.(null)}
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
      className={[
        "relative border bg-background/40 p-3 sm:p-3.5 transition-all duration-200 overflow-hidden",
        ringClass,
        interactive ? "cursor-pointer focus:outline-none" : "",
      ].join(" ")}
    >
      <div className="flex gap-3 sm:gap-4 items-stretch">
        {/* Left identity cell — Vault-Cell-style: icon centered, name + Lv subtitle */}
        <IdentityCell
          icon={meta.iconKey}
          name={name}
          level={meta.autonomyLevel}
          t={t}
          tokens={tokens}
        />
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
          <p className="text-[12.5px] text-on-surface-variant leading-relaxed">
            {description}
          </p>
          <div className="flex items-center gap-2 flex-wrap font-label text-[9px] tracking-[0.2em] uppercase">
            <span className="px-1.5 py-0.5 border border-outline-variant/40 text-on-surface-variant/80">
              {meta.provider}
            </span>
            <span className="px-1.5 py-0.5 border border-outline-variant/40 text-on-surface-variant/80 font-mono normal-case tracking-normal">
              {summary.id}
            </span>
            {!summary.envOk ? (
              // KEY missing — the only place status (warning) leaks into the
              // card. Painted in rose so it stands out against the level-themed
              // rest of the row.
              isAdmin && summary.missingEnvVars.length > 0 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfigure(summary.missingEnvVars[0]);
                  }}
                  title={summary.missingEnvVars.join(", ")}
                  className="px-1.5 py-0.5 border border-rose-400/70 text-rose-300 bg-rose-400/[0.08] hover:bg-rose-400/[0.15] normal-case tracking-normal font-mono shadow-[0_0_6px_rgba(251,113,133,0.25)]"
                >
                  {t.aiClergy.secretConfigure} · {summary.missingEnvVars[0]}
                </button>
              ) : (
                <span
                  className="px-1.5 py-0.5 border border-rose-400/50 text-rose-300 bg-rose-400/[0.06] normal-case tracking-normal font-mono"
                  title={summary.missingEnvVars.join(", ")}
                >
                  {format(t.aiClergy.capabilityRequiresEnv, {
                    vars: summary.missingEnvVars.join(", "),
                  })}
                </span>
              )
            ) : summary.stats.total === 0 ? (
              <span className="text-on-surface-variant/60 normal-case tracking-normal">
                {t.aiClergy.capabilityNoCalls}
              </span>
            ) : (
              <>
                <span className="text-on-surface-variant/80 normal-case tracking-normal">
                  {format(t.aiClergy.capabilityRecentSummary, {
                    count: summary.stats.total,
                    successRate: successRate ?? 0,
                  })}
                </span>
                {summary.stats.avgLatencyMs != null ? (
                  <span className="text-on-surface-variant/60 normal-case tracking-normal">
                    {format(t.aiClergy.capabilityAvgLatency, {
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
                      {t.aiClergy.secretReconfigure} · {envName}
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
                      {t.aiClergy.secretClear}
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

const AUTONOMY_KEYS = ["autonomyL0", "autonomyL1", "autonomyL2", "autonomyL3"] as const;

/**
 * Vault-Cell-style identity card on the left of each capability row.
 *   - Big icon centred at top
 *   - Capability name (primary tone)
 *   - Lv subtitle ("L1 · ASSISTED") in rarity colour
 *
 * The whole cell is bordered + tinted by autonomy level (rarity palette),
 * making the skill's class readable at a glance — same visual language as
 * the relic vault grid.
 */
function IdentityCell({
  icon,
  name,
  level,
  t,
  tokens,
}: {
  icon: string;
  name: string;
  level: 0 | 1 | 2 | 3;
  t: ReturnType<typeof useT>;
  tokens: typeof LEVEL_TOKENS[0 | 1 | 2 | 3];
}) {
  const subtitle = t.aiClergy[AUTONOMY_KEYS[level]];
  return (
    <div
      className={[
        "shrink-0 self-stretch w-[140px] sm:w-[160px] flex flex-col items-center justify-center",
        "px-3 py-3 border rounded-sm relative",
        tokens.border,
        tokens.bgTint,
      ].join(" ")}
      aria-label={`${name} · L${level} · ${subtitle}`}
    >
      <span className="absolute top-1.5 left-2 font-label text-[9px] tracking-[0.25em] text-on-surface-variant/60 tabular-nums">
        L{String(level).padStart(2, "0")}
      </span>
      <span
        className={`material-symbols-outlined text-[40px] leading-none ${tokens.text}`}
        style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="mt-3 text-on-surface text-sm font-medium leading-tight text-center line-clamp-1">
        {name}
      </span>
      <span
        className={`mt-2 font-label text-[10px] tracking-[0.3em] uppercase ${tokens.text}`}
      >
        L{level} · {subtitle}
      </span>
    </div>
  );
}
