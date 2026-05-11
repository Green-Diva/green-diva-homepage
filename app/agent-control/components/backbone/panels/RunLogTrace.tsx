"use client";

import type { RunLog } from "../types";

export function RunLogTrace({ runLog }: { runLog: RunLog }) {
  if (!runLog.length) return null;
  return (
    <details className="text-[11px] border border-on-surface-variant/30 rounded">
      <summary className="cursor-pointer font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant px-2 py-1">
        Trace ({runLog.length} entries)
      </summary>
      <div className="px-2 py-1 space-y-1 max-h-48 overflow-y-auto">
        {runLog.map((r, i) => (
          <div
            key={i}
            className={[
              "flex items-center justify-between gap-2 border-l-2 pl-2 py-0.5",
              r.skipped
                ? "border-on-surface-variant/30 text-on-surface-variant/60"
                : r.ok
                  ? "border-primary/60"
                  : "border-error/60 text-error",
            ].join(" ")}
          >
            <span className="truncate">
              {r.skipped ? "○" : r.ok ? "✓" : "✕"} {r.stepId}
              {r.branchLabel ? ` → ${r.branchLabel}` : ""}
            </span>
            <span className="shrink-0 text-on-surface-variant/60">
              {r.skipped ? "skipped" : `${r.durationMs}ms`}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
