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
  | "EXTRACTED";

type LogRow = {
  id: string;
  action: LogAction;
  actorNameSnapshot: string | null;
  targetNameSnapshot: string | null;
  notes: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  } catch {
    return iso;
  }
}

export default function LogPanel({ relicId, refreshKey = 0 }: { relicId: string; refreshKey?: number }) {
  const t = useT();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/relics/${relicId}/log`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        setRows(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [relicId, refreshKey]);

  function actionLabel(row: LogRow): string {
    switch (row.action) {
      case "CREATED":
        return t.adminRelics.logActionCREATED;
      case "EDITED":
        return t.adminRelics.logActionEDITED;
      case "MOVED": {
        const d = row.details as { from?: number; to?: number } | null;
        return format(t.adminRelics.logActionMOVED, {
          from: d?.from ?? "?",
          to: d?.to ?? "?",
        });
      }
      case "RARITY_CHANGED": {
        const d = row.details as { from?: string; to?: string } | null;
        return format(t.adminRelics.logActionRARITY_CHANGED, {
          from: d?.from ?? "?",
          to: d?.to ?? "?",
        });
      }
      case "SHARED":
        return t.adminRelics.logActionSHARED;
      case "SHARE_REVOKED":
        return t.adminRelics.logActionSHARE_REVOKED;
      case "EXTRACTED":
        return row.targetNameSnapshot
          ? format(t.adminRelics.logActionEXTRACTED_TO, { target: row.targetNameSnapshot })
          : t.adminRelics.logActionEXTRACTED;
    }
  }

  function actionColor(action: LogAction): string {
    switch (action) {
      case "CREATED":
        return "border-primary/40 text-primary";
      case "EDITED":
      case "MOVED":
      case "RARITY_CHANGED":
        return "border-on-surface-variant/30 text-on-surface-variant";
      case "SHARED":
        return "border-[#ff9bcd]/50 text-[#ff9bcd]";
      case "SHARE_REVOKED":
        return "border-on-surface-variant/30 text-on-surface-variant/70";
      case "EXTRACTED":
        return "border-error/50 text-error";
    }
  }

  return (
    <section className="border border-primary/15 bg-surface-container/30 p-4 space-y-3">
      <h2 className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
        {t.adminRelics.logTitle}
      </h2>
      {!loaded ? (
        <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/50">
          …
        </p>
      ) : rows.length === 0 ? (
        <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/50">
          {t.adminRelics.logEmpty}
        </p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row) => {
            const fields =
              row.action === "EDITED" && row.details && Array.isArray((row.details as { fields?: unknown }).fields)
                ? ((row.details as { fields: string[] }).fields.join(", "))
                : null;
            return (
              <li key={row.id} className="flex items-start gap-3 border-l border-primary/10 pl-3">
                <span
                  className={
                    "shrink-0 mt-0.5 px-2 py-0.5 border font-label text-[9px] tracking-[0.2em] uppercase " +
                    actionColor(row.action)
                  }
                >
                  {actionLabel(row)}
                </span>
                <div className="flex-1 min-w-0 text-[12px] text-on-surface-variant leading-[1.6]">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-label text-[10px] tracking-[0.2em] text-on-surface-variant/70 tabular-nums">
                      {fmtTime(row.createdAt)}
                    </span>
                    {row.actorNameSnapshot ? (
                      <span className="text-on-surface-variant/80">
                        {format(t.adminRelics.logBy, { actor: row.actorNameSnapshot })}
                      </span>
                    ) : null}
                    {row.targetNameSnapshot && row.action !== "EXTRACTED" ? (
                      <span className="text-[#ff9bcd]">
                        {format(t.adminRelics.logTo, { target: row.targetNameSnapshot })}
                      </span>
                    ) : null}
                  </div>
                  {fields ? (
                    <div className="font-label text-[10px] tracking-[0.15em] text-on-surface-variant/60 mt-0.5">
                      {format(t.adminRelics.logFieldsSummary, { fields })}
                    </div>
                  ) : null}
                  {row.notes ? (
                    <div className="text-[12px] text-on-surface/80 mt-1 italic">
                      “{row.notes}”
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
