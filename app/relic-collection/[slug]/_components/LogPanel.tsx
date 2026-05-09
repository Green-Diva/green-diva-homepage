"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type LogAction =
  | "CREATED"
  | "EDITED"
  | "MOVED"
  | "RARITY_CHANGED"
  | "SHARED"
  | "SHARE_REVOKED"
  | "EXTRACTED"
  | "GRANTED"
  | "GRANT_REVOKED"
  | "PROCESSING_STARTED"
  | "PROCESSING_STEP"
  | "PROCESSING_SUCCEEDED"
  | "PROCESSING_FAILED";

type ProcessingDetails = {
  phase?: string;
  step?: string;
  ok?: boolean;
  ms?: number;
  error?: string;
  finalStatus?: string;
};

type LogRow = {
  id: string;
  action: LogAction;
  actorNameSnapshot: string | null;
  targetNameSnapshot: string | null;
  notes: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

function detectLang(): "zh" | "en" {
  if (typeof document !== "undefined") {
    return document.documentElement.lang === "zh" ? "zh" : "en";
  }
  return "en";
}

const PAGE_SIZE = 5;

function rarityBorderClass(r: string | undefined | null): string {
  switch (r) {
    case "RARE":
      return "border-[#80c8ff]/40";
    case "EPIC":
      return "border-[#c79bff]/40";
    case "LEGENDARY":
      return "border-secondary/40";
    case "SPECIAL":
      return "border-[#ff9bcd]/40";
    default:
      return "border-primary/20";
  }
}

export default function LogPanel({
  relicId,
  refreshKey = 0,
  rarity,
}: {
  relicId: string;
  refreshKey?: number;
  rarity?: string;
}) {
  const t = useT();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lang] = useState<"zh" | "en">(() => detectLang());
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetch(`/api/relics/${relicId}/log`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        setRows(d);
        setLoaded(true);
        setPage(0);
      })
      .catch(() => setLoaded(true));
  }, [relicId, refreshKey]);

  function stepLabel(step: string | undefined | null): string {
    switch (step) {
      case "EXTRACT_ZIP":
        return t.adminRelics.logStepExtractZip;
      case "GENERATE_METADATA":
        return t.adminRelics.logStepGenerateMetadata;
      case "PACK_DERIVED":
        return t.adminRelics.logStepPackDerived;
      case "CUTOUT":
        return t.adminRelics.logStepCutout;
      case "MESHY":
        return t.adminRelics.logStepMeshy;
      default:
        return step ?? "?";
    }
  }

  function phaseLabel(phase: string | undefined | null): string {
    switch (phase) {
      case "finalize":
        return t.adminRelics.logPhaseFinalize;
      case "enhance2d":
        return t.adminRelics.logPhaseEnhance2d;
      case "3d":
        return t.adminRelics.logPhase3d;
      default:
        return t.adminRelics.logPhaseFinalize;
    }
  }

  function actionLabel(row: LogRow): string {
    switch (row.action) {
      case "CREATED":
        return t.adminRelics.logActionCREATED;
      case "EDITED":
        return t.adminRelics.logActionEDITED;
      case "MOVED":
        return t.adminRelics.logActionMOVED;
      case "RARITY_CHANGED": {
        const d = row.details as { from?: string; to?: string } | null;
        return format(t.adminRelics.logActionRARITY_CHANGED, { from: d?.from ?? "?", to: d?.to ?? "?" });
      }
      case "SHARED":
        return t.adminRelics.logActionSHARED;
      case "SHARE_REVOKED":
        return t.adminRelics.logActionSHARE_REVOKED;
      case "GRANTED":
        return t.adminRelics.logActionGRANTED;
      case "GRANT_REVOKED":
        return t.adminRelics.logActionGRANT_REVOKED;
      case "EXTRACTED":
        return t.adminRelics.logActionEXTRACTED;
      case "PROCESSING_STARTED":
        return t.adminRelics.logActionPROCESSING_STARTED;
      case "PROCESSING_STEP": {
        const d = row.details as ProcessingDetails | null;
        return format(t.adminRelics.logActionPROCESSING_STEP, { step: stepLabel(d?.step) });
      }
      case "PROCESSING_SUCCEEDED":
        return t.adminRelics.logActionPROCESSING_SUCCEEDED;
      case "PROCESSING_FAILED": {
        const d = row.details as ProcessingDetails | null;
        return format(t.adminRelics.logActionPROCESSING_FAILED, { step: stepLabel(d?.step) });
      }
    }
  }

  // Color families pair related actions: 分享=yellow, 授予=green, 提取=red,
  // 流水线 (PROCESSING_*)=info blue family, FAILED=error red.
  // Revokes share their pair's hue but use dashed border + line-through.
  function actionColor(action: LogAction): string {
    switch (action) {
      case "CREATED":
        return "border-on-surface/40 text-on-surface bg-on-surface/5";
      case "EDITED":
      case "MOVED":
      case "RARITY_CHANGED":
        return "border-on-surface-variant/25 text-on-surface-variant/80";
      case "SHARED":
        return "border-secondary/55 text-secondary bg-secondary/5";
      case "SHARE_REVOKED":
        return "border-dashed border-secondary/35 text-secondary/55 line-through";
      case "GRANTED":
        return "border-primary/55 text-primary bg-primary/5";
      case "GRANT_REVOKED":
        return "border-dashed border-primary/35 text-primary/55 line-through";
      case "EXTRACTED":
        return "border-error/60 text-error bg-error/10 shadow-[0_0_8px_rgba(255,77,77,0.18)]";
      case "PROCESSING_STARTED":
        return "border-info/55 text-info bg-info/5";
      case "PROCESSING_STEP":
        return "border-info/30 text-info/75";
      case "PROCESSING_SUCCEEDED":
        return "border-info/55 text-info bg-info/10";
      case "PROCESSING_FAILED":
        return "border-error/60 text-error bg-error/10 shadow-[0_0_8px_rgba(255,77,77,0.18)]";
    }
  }

  function subjectColor(action: LogAction): string {
    switch (action) {
      case "SHARED":
      case "SHARE_REVOKED":
        return "text-secondary/85";
      case "GRANTED":
      case "GRANT_REVOKED":
        return "text-primary/85";
      case "PROCESSING_STARTED":
      case "PROCESSING_STEP":
      case "PROCESSING_SUCCEEDED":
        return "text-info/80";
      case "PROCESSING_FAILED":
        return "text-error/85";
      default:
        return "text-on-surface-variant";
    }
  }

  function fmtDateTime(iso: string): string {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}/${m}/${day} ${hh}:${mm}`;
  }

  function fmtFullLocal(iso: string): string {
    return new Date(iso).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function subjectPhrase(row: LogRow): string | null {
    const actor = row.actorNameSnapshot ?? "—";
    const target = row.targetNameSnapshot ?? "—";
    switch (row.action) {
      case "SHARED":
        return format(t.adminRelics.logSubjShared, { actor, target });
      case "GRANTED":
        return format(t.adminRelics.logSubjGranted, { actor, target });
      case "SHARE_REVOKED":
        return format(t.adminRelics.logSubjShareRevoked, { actor, target });
      case "GRANT_REVOKED":
        return format(t.adminRelics.logSubjGrantRevoked, { actor, target });
      case "EXTRACTED":
        return row.actorNameSnapshot
          ? format(t.adminRelics.logSubjExtracted, { actor })
          : null;
      case "CREATED":
        return row.actorNameSnapshot
          ? format(t.adminRelics.logSubjCreated, { actor })
          : null;
      case "EDITED":
        return row.actorNameSnapshot
          ? format(t.adminRelics.logSubjEdited, { actor })
          : null;
      case "MOVED":
        return row.actorNameSnapshot
          ? format(t.adminRelics.logSubjMoved, { actor })
          : null;
      case "PROCESSING_STARTED": {
        const d = row.details as ProcessingDetails | null;
        const phase = phaseLabel(d?.phase);
        return row.actorNameSnapshot
          ? format(t.adminRelics.logSubjProcessingStarted, { actor, phase })
          : format(t.adminRelics.logSubjProcessingStartedSystem, { phase });
      }
      case "PROCESSING_STEP":
        // Step label is already in the badge — no subject phrase to avoid
        // duplication. Inline details (ms / error) appear after the badge.
        return null;
      case "PROCESSING_SUCCEEDED": {
        const d = row.details as ProcessingDetails | null;
        return format(t.adminRelics.logSubjProcessingSucceeded, {
          phase: phaseLabel(d?.phase),
        });
      }
      case "PROCESSING_FAILED": {
        const d = row.details as ProcessingDetails | null;
        return format(t.adminRelics.logSubjProcessingFailed, {
          phase: phaseLabel(d?.phase),
          step: stepLabel(d?.step),
        });
      }
      default:
        return row.actorNameSnapshot
          ? format(t.adminRelics.logBy, { actor: row.actorNameSnapshot })
          : null;
    }
  }

  return (
    <section className={"border bg-surface-container/30 p-4 space-y-3 " + rarityBorderClass(rarity)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
          {t.adminRelics.logTitle}
        </h2>
        {rows.length > PAGE_SIZE ? (
          <div className="flex items-center gap-1.5 font-label text-[9px] tracking-[0.2em] uppercase">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-1.5 py-0.5 border border-primary/20 text-on-surface-variant hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {t.adminRelics.logPagePrev}
            </button>
            <span className="text-secondary tabular-nums">
              {format(t.adminRelics.logPageInfo, { page: safePage + 1, total: totalPages })}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-1.5 py-0.5 border border-primary/20 text-on-surface-variant hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {t.adminRelics.logPageNext}
            </button>
          </div>
        ) : null}
      </div>
      {!loaded || rows.length === 0 ? (
        <ol className="space-y-1 relative">
          <p className="absolute inset-0 flex items-center justify-center font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/50 pointer-events-none">
            {!loaded ? "…" : t.adminRelics.logEmpty}
          </p>
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <li key={`empty-pad-${i}`} aria-hidden className="border-l border-transparent pl-2.5 text-[12px] leading-[1.55] invisible">
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 px-2 py-0.5 border font-label text-[9px] tracking-[0.2em] uppercase">
                  &nbsp;
                </span>
                <span className="flex-1" />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="space-y-1">
          {pagedRows.map((row) => {
            const fields =
              row.action === "EDITED" &&
              row.details &&
              Array.isArray((row.details as { fields?: unknown }).fields)
                ? ((row.details as { fields: string[] }).fields.join(", "))
                : null;
            const moveDetails =
              row.action === "MOVED" && row.details
                ? format(t.adminRelics.logMoveDetails, {
                    from: (row.details as { from?: number }).from ?? "?",
                    to: (row.details as { to?: number }).to ?? "?",
                  })
                : null;
            const processingExtra = (() => {
              if (row.action !== "PROCESSING_STEP" && row.action !== "PROCESSING_FAILED") {
                return null;
              }
              const d = row.details as ProcessingDetails | null;
              const parts: string[] = [];
              if (typeof d?.ms === "number") parts.push(`${d.ms}ms`);
              if (d?.error) {
                const trimmed = d.error.length > 80 ? d.error.slice(0, 80) + "…" : d.error;
                parts.push(format(t.adminRelics.logProcessingError, { error: trimmed }));
              }
              return parts.length ? parts.join(" ") : null;
            })();
            const inlineDetails = moveDetails
              ? `(${moveDetails})`
              : fields
                ? `(${format(t.adminRelics.logFieldsSummary, { fields })})`
                : processingExtra
                  ? `(${processingExtra})`
                  : null;
            const subject = subjectPhrase(row);
            return (
              <li
                key={row.id}
                className="border-l border-primary/10 pl-2.5 text-[12px] text-on-surface-variant leading-[1.55]"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={
                      "shrink-0 px-2 py-0.5 border font-label text-[9px] tracking-[0.2em] uppercase " +
                      actionColor(row.action)
                    }
                  >
                    {actionLabel(row)}
                  </span>
                  {subject || inlineDetails ? (
                    <span className={"flex-1 min-w-0 truncate " + subjectColor(row.action)}>
                      {subject}
                      {subject && inlineDetails ? " " : null}
                      {inlineDetails ? (
                        <span className="text-on-surface-variant/60 tabular-nums">{inlineDetails}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span
                    className="shrink-0 font-label text-[10px] tracking-[0.15em] text-on-surface-variant/60 tabular-nums"
                    title={fmtFullLocal(row.createdAt)}
                    suppressHydrationWarning
                  >
                    {fmtDateTime(row.createdAt)}
                  </span>
                </div>
                {row.notes ? (
                  <div className="text-[12px] text-on-surface/80 mt-1 italic">
                    “{row.notes}”
                  </div>
                ) : null}
              </li>
            );
          })}
          {Array.from({ length: PAGE_SIZE - pagedRows.length }).map((_, i) => (
            <li key={`pad-${i}`} aria-hidden className="border-l border-transparent pl-2.5 text-[12px] leading-[1.55] invisible">
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 px-2 py-0.5 border font-label text-[9px] tracking-[0.2em] uppercase">
                  &nbsp;
                </span>
                <span className="flex-1" />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
