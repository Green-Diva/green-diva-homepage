"use client";

import { useEffect, useMemo, useState } from "react";
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
  | "GRANT_REVOKED";

type LogRow = {
  id: string;
  action: LogAction;
  actorNameSnapshot: string | null;
  targetNameSnapshot: string | null;
  notes: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function detectLang(): "zh" | "en" {
  if (typeof document !== "undefined") {
    return document.documentElement.lang === "zh" ? "zh" : "en";
  }
  return "en";
}

const PAGE_SIZE = 5;

export default function LogPanel({ relicId, refreshKey = 0 }: { relicId: string; refreshKey?: number }) {
  const t = useT();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lang, setLang] = useState<"zh" | "en">("en");
  const [page, setPage] = useState(0);

  useEffect(() => {
    setLang(detectLang());
  }, []);

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
    }
  }

  // Color families pair related actions: 分享=yellow, 授予=green, 提取=red.
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
      default:
        return "text-on-surface-variant";
    }
  }

  function fmtRelative(iso: string): string {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < MIN) return t.adminRelics.logTimeJustNow;
    if (diff < HOUR) return format(t.adminRelics.logTimeMinutesAgo, { n: Math.floor(diff / MIN) });
    if (diff < DAY) return format(t.adminRelics.logTimeHoursAgo, { n: Math.floor(diff / HOUR) });
    if (diff < 7 * DAY) return format(t.adminRelics.logTimeDaysAgo, { n: Math.floor(diff / DAY) });
    // > 7 days: short local date
    return d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function fmtFullLocal(iso: string): string {
    return new Date(iso).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function dayKey(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Group by local day (preserves order — rows arrive newest-first)
  const grouped = useMemo(() => {
    const out: { day: string; items: LogRow[] }[] = [];
    for (const row of pagedRows) {
      const k = dayKey(row.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === k) last.items.push(row);
      else out.push({ day: k, items: [row] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagedRows, lang]);

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
      default:
        return row.actorNameSnapshot
          ? format(t.adminRelics.logBy, { actor: row.actorNameSnapshot })
          : null;
    }
  }

  return (
    <section className="border border-primary/15 bg-surface-container/30 p-4 space-y-3">
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
      {!loaded ? (
        <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/50">…</p>
      ) : rows.length === 0 ? (
        <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/50">
          {t.adminRelics.logEmpty}
        </p>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => (
            <div key={group.day} className="space-y-1.5">
              <div
                className="font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant/45 tabular-nums"
                suppressHydrationWarning
              >
                {group.day}
              </div>
              <ol className="space-y-1">
                {group.items.map((row) => {
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
                  const inlineDetails = moveDetails
                    ? `(${moveDetails})`
                    : fields
                      ? `(${format(t.adminRelics.logFieldsSummary, { fields })})`
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
                          {fmtRelative(row.createdAt)}
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
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
