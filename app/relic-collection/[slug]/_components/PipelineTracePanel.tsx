// Admin-only trace viewer. Renders the Relic.pipelineTrace JSON (the DAG
// runLog from the most recent agent invocation) as a collapsed panel — one
// row per node, colored by ok / skipped / failed. Skipped rows include the
// branch label that explains why the node didn't run on this run.
//
// The panel is rendered server-side (no interactivity needed beyond the
// native <details> toggle). Trace stays bounded by AgentJob limits upstream.

import type { Dictionary } from "@/lib/i18n/types";

type RunLogEntry = {
  stepId: string;
  skillId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  ok?: boolean;
  errorCode?: string;
  errorMessage?: string;
  skipped?: boolean;
  branchLabel?: string;
  output?: unknown;
};

function isRunLogEntry(v: unknown): v is RunLogEntry {
  return typeof v === "object" && v !== null && "stepId" in v;
}

export default function PipelineTracePanel({
  trace,
  locale,
  t,
}: {
  trace: unknown;
  locale: "zh" | "en";
  t: Dictionary;
}) {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  const entries = trace.filter(isRunLogEntry);
  if (entries.length === 0) return null;
  void t; // reserved for future i18n labels

  return (
    <details className="border border-on-surface-variant/30 bg-surface-container/30 rounded">
      <summary className="cursor-pointer px-3 py-2 font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant">
        {locale === "zh" ? "代理执行轨迹" : "Agent Trace"} ({entries.length})
      </summary>
      <div className="px-3 py-2 space-y-1 text-[11px]">
        {entries.map((e, i) => {
          const isOk = e.ok === true && !e.skipped;
          const isSkipped = e.skipped === true;
          const colorClass = isSkipped
            ? "border-on-surface-variant/30 text-on-surface-variant/60"
            : isOk
              ? "border-primary/60 text-on-surface"
              : "border-error/60 text-error";
          const symbol = isSkipped ? "○" : isOk ? "✓" : "✕";
          return (
            <div key={i} className={"border-l-2 pl-2 py-0.5 flex items-center justify-between gap-2 " + colorClass}>
              <span className="truncate">
                {symbol} <span className="font-mono">{e.stepId}</span>
                {e.branchLabel ? (
                  <span className="ml-1 text-on-surface-variant/60">→ {e.branchLabel}</span>
                ) : null}
                {e.errorCode ? <span className="ml-1 text-error">({e.errorCode})</span> : null}
              </span>
              <span className="shrink-0 text-on-surface-variant/60">
                {isSkipped
                  ? locale === "zh"
                    ? "跳过"
                    : "skipped"
                  : `${e.durationMs ?? 0}ms`}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
