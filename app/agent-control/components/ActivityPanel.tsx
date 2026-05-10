"use client";

// Phase 7 — cross-module Activity tab. Tabular view of recent AgentJobs
// across all scenes / agents, filterable by scene / agent / status /
// time window. Click a row to inspect input/output/runLog inline (lazy
// fetch via /api/agent-jobs/[jobId]).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import CyberPanel from "./CyberPanel";

type AgentJobRow = {
  id: string;
  agentId: string;
  mode: "MECHANICAL" | "AUTONOMOUS";
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  errorCode: string | null;
  errorMessage: string | null;
  sceneKey: string | null;
  actorUserId: string | null;
  actorName: string | null;
  routedTo: string | null;
  attempts: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  agent: { codename: string; mode: string } | null;
};

type FilterOptions = {
  scenes: string[];
  agents: { id: string; codename: string }[];
  statuses: string[];
};

type ListResponse = {
  rows: AgentJobRow[];
  filterOptions: FilterOptions;
  meta: { limit: number; returned: number };
};

const TIME_WINDOWS: { key: string; ms: number | null; labelEn: string; labelZh: string }[] = [
  { key: "1h", ms: 60 * 60_000, labelEn: "Last hour", labelZh: "近 1 小时" },
  { key: "24h", ms: 24 * 60 * 60_000, labelEn: "Last 24 hours", labelZh: "近 24 小时" },
  { key: "7d", ms: 7 * 24 * 60 * 60_000, labelEn: "Last 7 days", labelZh: "近 7 天" },
  { key: "all", ms: null, labelEn: "All time", labelZh: "全部时间" },
];

function fmtDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "—";
  const ms = Math.max(0, endMs - startMs);
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1_000)}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(iso)}`;
}

const STATUS_COLORS: Record<AgentJobRow["status"], string> = {
  PENDING: "border-on-surface-variant/30 bg-on-surface-variant/[0.05] text-on-surface-variant",
  RUNNING: "border-primary/40 bg-primary/[0.08] text-primary",
  SUCCESS: "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300",
  FAILED: "border-rose-500/40 bg-rose-500/[0.08] text-rose-400",
};

export default function ActivityPanel({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const [filters, setFilters] = useState<{
    sceneKey: string;
    agentId: string;
    status: string;
    window: string;
  }>({ sceneKey: "", agentId: "", status: "", window: "24h" });
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<unknown>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (filters.sceneKey) qs.set("sceneKey", filters.sceneKey);
      if (filters.agentId) qs.set("agentId", filters.agentId);
      if (filters.status) qs.set("status", filters.status);
      const window = TIME_WINDOWS.find((w) => w.key === filters.window);
      if (window?.ms) qs.set("sinceMs", String(window.ms));
      qs.set("limit", "100");
      const res = await fetch(`/api/agent-jobs?${qs.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData((await res.json()) as ListResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (!isAdmin) return;
    // Standard fetch-on-mount + refetch-on-filter-change. ESLint's
    // react-hooks/set-state-in-effect rule fires because fetchRows
    // synchronously calls setLoading(true) — but that's exactly what
    // we want here (show spinner immediately). Cancellation flag keeps
    // late responses from clobbering newer state when filters change
    // mid-flight.
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await fetchRows();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRows, isAdmin]);

  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      total: rows.length,
      success: rows.filter((r) => r.status === "SUCCESS").length,
      failed: rows.filter((r) => r.status === "FAILED").length,
      running: rows.filter((r) => r.status === "RUNNING" || r.status === "PENDING").length,
    };
  }, [data]);

  async function toggleExpand(jobId: string) {
    if (expandedId === jobId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(jobId);
    setExpandedDetail(null);
    try {
      const r = await fetch(`/api/agent-jobs/${encodeURIComponent(jobId)}`);
      if (r.ok) setExpandedDetail(await r.json());
    } catch {
      // silent — drawer just stays empty
    }
  }

  if (!isAdmin) {
    return (
      <CyberPanel className="p-6" markers={["tl", "br"]}>
        <p className="text-on-surface-variant text-sm">{t.agentControl.activityAdminOnly}</p>
      </CyberPanel>
    );
  }

  const filterOptions = data?.filterOptions ?? { scenes: [], agents: [], statuses: [] };

  return (
    <div className="space-y-4 pb-6">
      {/* Header + filters */}
      <CyberPanel className="px-4 py-3" markers={["tl", "br"]}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-label text-[10px] tracking-[0.3em] text-primary uppercase">
            {t.agentControl.activityTitle}
          </h2>
          <div className="flex items-center gap-3 text-[11px] font-label tracking-[0.2em] uppercase">
            <span className="text-on-surface-variant">
              {t.agentControl.activityCountTotal}: {counts.total}
            </span>
            <span className="text-emerald-300">✓ {counts.success}</span>
            <span className="text-rose-400">✗ {counts.failed}</span>
            <span className="text-primary">↻ {counts.running}</span>
            <button
              type="button"
              onClick={() => fetchRows()}
              disabled={loading}
              className="min-h-[28px] px-3 rounded border border-primary/40 bg-primary/[0.05] hover:bg-primary/[0.12] text-primary disabled:opacity-50"
            >
              {loading ? t.agentControl.activityLoading : t.agentControl.activityRefresh}
            </button>
          </div>
        </div>
      </CyberPanel>

      <CyberPanel className="p-3 space-y-2" markers={["tl"]}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <FilterSelect
            label={t.agentControl.activityFilterScene}
            value={filters.sceneKey}
            onChange={(v) => setFilters((s) => ({ ...s, sceneKey: v }))}
            options={[{ value: "", label: t.agentControl.activityAny }, ...filterOptions.scenes.map((k) => ({ value: k, label: k }))]}
          />
          <FilterSelect
            label={t.agentControl.activityFilterAgent}
            value={filters.agentId}
            onChange={(v) => setFilters((s) => ({ ...s, agentId: v }))}
            options={[{ value: "", label: t.agentControl.activityAny }, ...filterOptions.agents.map((a) => ({ value: a.id, label: a.codename }))]}
          />
          <FilterSelect
            label={t.agentControl.activityFilterStatus}
            value={filters.status}
            onChange={(v) => setFilters((s) => ({ ...s, status: v }))}
            options={[{ value: "", label: t.agentControl.activityAny }, ...filterOptions.statuses.map((s) => ({ value: s, label: s }))]}
          />
          <FilterSelect
            label={t.agentControl.activityFilterWindow}
            value={filters.window}
            onChange={(v) => setFilters((s) => ({ ...s, window: v }))}
            options={TIME_WINDOWS.map((w) => ({ value: w.key, label: w.labelEn }))}
          />
        </div>
      </CyberPanel>

      {err ? (
        <CyberPanel className="p-3" markers={["tl"]}>
          <p className="text-sm text-rose-400 font-mono">{err}</p>
        </CyberPanel>
      ) : null}

      {/* Rows */}
      <div className="space-y-1.5">
        {(data?.rows ?? []).map((row) => (
          <ActivityRow
            key={row.id}
            row={row}
            expanded={expandedId === row.id}
            detail={expandedId === row.id ? expandedDetail : null}
            onToggle={() => void toggleExpand(row.id)}
          />
        ))}
        {data && data.rows.length === 0 ? (
          <CyberPanel className="p-6" markers={["tl"]}>
            <p className="text-on-surface-variant text-sm text-center">
              {t.agentControl.activityEmpty}
            </p>
          </CyberPanel>
        ) : null}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <div className="font-label text-[9px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
        {label}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface-variant border border-primary/30 rounded px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActivityRow({
  row,
  expanded,
  detail,
  onToggle,
}: {
  row: AgentJobRow;
  expanded: boolean;
  detail: unknown;
  onToggle: () => void;
}) {
  const t = useT();
  const statusCls = STATUS_COLORS[row.status];
  return (
    <CyberPanel className="px-3 py-2" markers={["tl"]}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 flex-wrap text-left"
      >
        <span className="text-[10px] text-on-surface-variant font-mono w-[100px] shrink-0">
          {fmtDate(row.createdAt)}
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border font-label tracking-[0.18em] uppercase shrink-0 ${statusCls}`}
        >
          {row.status}
        </span>
        <code className="font-mono text-[11px] text-primary shrink-0">
          {row.sceneKey ?? "(direct)"}
        </code>
        <span className="text-on-surface-variant text-[11px]">→</span>
        <code className="font-mono text-[11px] text-secondary">
          {row.agent?.codename ?? "?"}
        </code>
        {row.routedTo === "fallback" ? (
          <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/[0.08] text-amber-400 font-label tracking-[0.18em] uppercase">
            FALLBACK
          </span>
        ) : null}
        <span className="text-[10px] text-on-surface-variant">
          {fmtDuration(row.startedAt, row.endedAt)}
        </span>
        {row.actorName ? (
          <span className="text-[10px] text-on-surface-variant">
            · {row.actorName}
          </span>
        ) : null}
        <span className="ml-auto material-symbols-outlined text-[16px] text-on-surface-variant">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </button>
      {row.errorMessage ? (
        <p className="mt-1 text-[11px] text-rose-400 font-mono break-all">
          {row.errorCode ? `[${row.errorCode}] ` : ""}{row.errorMessage.slice(0, 200)}
        </p>
      ) : null}
      {expanded ? (
        <div className="mt-2 pt-2 border-t border-primary/10">
          {detail ? (
            <pre className="text-[10px] font-mono text-on-surface whitespace-pre-wrap break-all max-h-96 overflow-auto bg-surface-variant/40 rounded p-2">
              {JSON.stringify(detail, null, 2)}
            </pre>
          ) : (
            <p className="text-[11px] text-on-surface-variant">{t.agentControl.activityLoading}</p>
          )}
        </div>
      ) : null}
    </CyberPanel>
  );
}
