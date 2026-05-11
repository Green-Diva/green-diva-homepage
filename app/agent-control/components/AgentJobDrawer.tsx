"use client";

// Right-anchored drawer showing invocation history for one agent.
// Inline Test Invoke trigger at the top (admin-only). Polling at 3s
// when any job is PENDING/RUNNING; idles otherwise to avoid burning
// network. Status transitions appear without a manual refresh.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentErrorCode } from "@/lib/agent-errors";
import { DIAGNOSTIC_HINTS_ZH } from "@/lib/agent-errors-i18n";

function hintFor(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  return DIAGNOSTIC_HINTS_ZH[code as AgentErrorCode];
}

type JobStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
type Mode = "MECHANICAL" | "AUTONOMOUS";

type JobListRow = {
  id: string;
  mode: Mode;
  status: JobStatus;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobDetail = JobListRow & {
  agentId: string;
  input: unknown;
  output: unknown;
  runLog: unknown;
};

type Props = {
  agentId: string;
  agentCodename: string;
  isAdmin: boolean;
  onClose: () => void;
};

const STATUS_BADGE: Record<JobStatus, string> = {
  PENDING: "border-amber-300/50 text-amber-200 bg-amber-300/[0.10]",
  RUNNING: "border-primary/60 text-primary bg-primary/[0.12]",
  SUCCESS: "border-emerald-400/50 text-emerald-300 bg-emerald-400/[0.10]",
  FAILED: "border-error/60 text-error bg-error/[0.10]",
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 1000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

function durationMs(job: { startedAt: string | null; finishedAt: string | null }): number | null {
  if (!job.startedAt || !job.finishedAt) return null;
  return new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function AgentJobDrawer({ agentId, agentCodename, isAdmin, onClose }: Props) {
  const [jobs, setJobs] = useState<JobListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyInvoke, setBusyInvoke] = useState(false);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [sampleInput, setSampleInput] = useState('{ "prompt": "hello" }');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, JobDetail>>({});
  const [retryBusy, setRetryBusy] = useState<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const jobsRef = useRef<JobListRow[]>([]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // ESC close + lock body scroll
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Initial fetch + 3s polling while any job is PENDING/RUNNING.
  // Reads latest jobs via ref so the interval doesn't churn on every state change.
  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      try {
        const r = await fetch(`/api/agents/${agentId}/jobs`);
        if (!r.ok) return;
        const data: JobListRow[] = await r.json();
        if (!cancelled) setJobs(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchOnce();
    const t = setInterval(() => {
      const inFlight = jobsRef.current.some((j) => j.status === "PENDING" || j.status === "RUNNING");
      if (inFlight) fetchOnce();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [agentId]);

  async function refetchList() {
    const r = await fetch(`/api/agents/${agentId}/jobs`);
    if (!r.ok) return;
    const data: JobListRow[] = await r.json();
    setJobs(data);
  }

  async function expand(jobId: string) {
    if (expanded === jobId) {
      setExpanded(null);
      return;
    }
    setExpanded(jobId);
    if (!details[jobId]) {
      const r = await fetch(`/api/agents/${agentId}/jobs/${jobId}`);
      if (r.ok) {
        const d = await r.json();
        setDetails((s) => ({ ...s, [jobId]: d }));
      }
    }
  }

  async function onInvoke() {
    setInvokeError(null);
    let parsed: unknown = null;
    const trimmed = sampleInput.trim();
    if (trimmed) {
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        setInvokeError(`input JSON: ${e instanceof Error ? e.message : "invalid"}`);
        return;
      }
    }
    setBusyInvoke(true);
    try {
      const r = await fetch(`/api/agents/${agentId}/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: parsed }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setInvokeError(typeof j.error === "string" ? j.error : `invoke failed (${r.status})`);
        return;
      }
      await refetchList();
    } catch (e) {
      setInvokeError(e instanceof Error ? e.message : "fetch threw");
    } finally {
      setBusyInvoke(false);
    }
  }

  async function onRetry(jobId: string) {
    setRetryBusy(jobId);
    try {
      const r = await fetch(`/api/agents/${agentId}/jobs/${jobId}/retry`, { method: "POST" });
      if (!r.ok) return;
      // Drop cached detail so the next expand fetches fresh state.
      setDetails((s) => {
        const c = { ...s };
        delete c[jobId];
        return c;
      });
      await refetchList();
    } finally {
      setRetryBusy(null);
    }
  }

  const portal = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);
  if (!portal) return null;

  const inFlightCount = jobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING").length;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Invocations · ${agentCodename}`}
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[520px] cyber-panel overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-primary/15 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
          <div className="min-w-0">
            <h2 className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">Invocations</h2>
            <p className="font-headline text-base text-on-surface truncate">{agentCodename}</p>
          </div>
          <div className="flex items-center gap-2">
            {inFlightCount > 0 && (
              <span className="font-label text-[9px] tracking-[0.2em] uppercase text-primary/70 flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                {inFlightCount} live
              </span>
            )}
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
              aria-label="close"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Test Invoke (admin only) */}
        {isAdmin && (
          <div className="p-4 border-b border-primary/15 flex flex-col gap-2">
            <h3 className="font-label text-[10px] tracking-[0.25em] text-secondary/80 uppercase">Test Invoke</h3>
            <label className="font-label text-[9px] tracking-[0.2em] text-primary/60 uppercase">
              Input (JSON, blank = null)
            </label>
            <textarea
              rows={4}
              value={sampleInput}
              onChange={(e) => setSampleInput(e.target.value)}
              className="w-full bg-surface-variant/30 border border-primary/20 rounded px-3 py-2 font-mono text-[11px] text-on-surface focus:outline-none focus:border-primary/60 focus:bg-surface-variant/50 resize-y"
              spellCheck={false}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-on-surface-variant/60">
                Phase 2 returns FAILED with{" "}
                <code className="text-secondary/80">{"BACKBONE_NOT_IMPLEMENTED"}</code> /{" "}
                <code className="text-secondary/80">{"ORCHESTRATOR_NOT_IMPLEMENTED"}</code> until Phase 3 / 4 land.
              </p>
              <button
                type="button"
                onClick={onInvoke}
                disabled={busyInvoke}
                className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[36px] px-4 flex items-center gap-2 shrink-0"
              >
                <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                {busyInvoke ? "Sending…" : "Invoke"}
              </button>
            </div>
            {invokeError && <p className="text-error text-xs">{invokeError}</p>}
          </div>
        )}

        {/* History */}
        <div className="flex-1 p-4 flex flex-col gap-2">
          <h3 className="font-label text-[10px] tracking-[0.25em] text-secondary/80 uppercase mb-1">
            History {jobs.length > 0 && <span className="text-on-surface-variant/50">· {jobs.length}</span>}
          </h3>
          {loading ? (
            <p className="text-on-surface-variant text-sm">Loading…</p>
          ) : jobs.length === 0 ? (
            <p className="text-on-surface-variant/60 text-sm">No invocations yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {jobs.map((j) => {
                const isExpanded = expanded === j.id;
                const dur = formatDuration(durationMs(j));
                const detail = details[j.id];
                return (
                  <li
                    key={j.id}
                    className="border border-primary/15 rounded bg-surface-variant/10 hover:bg-surface-variant/20 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => expand(j.id)}
                      className="w-full text-left p-3 flex flex-col gap-1"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-label text-[9px] tracking-[0.2em] uppercase border rounded-sm px-1.5 py-0.5 ${STATUS_BADGE[j.status]}`}
                        >
                          {j.status}
                        </span>
                        <span className="font-label text-[9px] tracking-[0.2em] uppercase text-on-surface-variant/60">
                          {j.mode === "MECHANICAL" ? "MECH" : "AUTO"}
                        </span>
                        {dur && (
                          <span className="font-label text-[9px] tracking-[0.2em] uppercase text-on-surface-variant/50">
                            {dur}
                          </span>
                        )}
                        {j.attempts > 1 && (
                          <span className="font-label text-[9px] tracking-[0.2em] uppercase text-on-surface-variant/50">
                            {j.attempts}/{j.maxAttempts}
                          </span>
                        )}
                        <span className="font-label text-[9px] tracking-[0.2em] uppercase text-on-surface-variant/50 ml-auto">
                          {relTime(j.createdAt)}
                        </span>
                      </div>
                      {j.errorCode && (
                        <p className="text-error/80 text-[11px] font-mono truncate">
                          {j.errorCode}
                          {j.errorMessage ? ` · ${j.errorMessage}` : ""}
                        </p>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 flex flex-col gap-3 border-t border-primary/10 pt-3">
                        {!detail ? (
                          <p className="text-on-surface-variant text-xs">Loading detail…</p>
                        ) : (
                          <>
                            <Section label="Input">
                              <pre className="font-mono text-[10px] whitespace-pre-wrap break-all max-h-32 overflow-auto">
                                {JSON.stringify(detail.input, null, 2)}
                              </pre>
                            </Section>
                            {detail.status === "SUCCESS" && (
                              <Section label="Output">
                                <pre className="font-mono text-[10px] whitespace-pre-wrap break-all max-h-32 overflow-auto">
                                  {JSON.stringify(detail.output, null, 2)}
                                </pre>
                              </Section>
                            )}
                            {detail.errorMessage && (
                              <Section
                                label={
                                  detail.errorCode === "SCENE_OUTPUT_INVALID"
                                    ? "Scene Contract Mismatch · SCENE_OUTPUT_INVALID"
                                    : `Error · ${detail.errorCode ?? "UNKNOWN"}`
                                }
                              >
                                {detail.errorCode === "SCENE_OUTPUT_INVALID" ? (
                                  <div className="space-y-1.5">
                                    <p className="text-amber-300 text-[11px] leading-snug">
                                      📐 Agent leaf output didn&apos;t match the
                                      bound scene&apos;s outputSchema. Add or
                                      fix the tail{" "}
                                      <code className="text-amber-200">transform</code>{" "}
                                      node so it produces the contract shape.
                                    </p>
                                    <p className="text-error/80 text-[11px] font-mono whitespace-pre-wrap break-all">
                                      {detail.errorMessage}
                                    </p>
                                  </div>
                                ) : (
                                  <div className="space-y-1.5">
                                    <p className="text-error/80 text-[11px] whitespace-pre-wrap break-all">
                                      {detail.errorMessage}
                                    </p>
                                    {hintFor(detail.errorCode) && (
                                      <p className="text-on-surface-variant text-[11px] leading-snug">
                                        💡 {hintFor(detail.errorCode)}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </Section>
                            )}
                            {Array.isArray(detail.runLog) && detail.runLog.length > 0 && (
                              <Section label={`Run Log · ${detail.runLog.length} step(s)`}>
                                <pre className="font-mono text-[10px] whitespace-pre-wrap break-all max-h-40 overflow-auto">
                                  {JSON.stringify(detail.runLog, null, 2)}
                                </pre>
                              </Section>
                            )}
                            {isAdmin && j.status === "FAILED" && (
                              <button
                                type="button"
                                onClick={() => onRetry(j.id)}
                                disabled={retryBusy === j.id}
                                className="self-start font-label text-[10px] tracking-[0.2em] uppercase border border-primary/40 text-primary hover:bg-primary/10 rounded px-3 min-h-[32px] flex items-center gap-1.5 transition-colors"
                              >
                                <span className="material-symbols-outlined text-[14px]">replay</span>
                                {retryBusy === j.id ? "Retrying…" : "Retry"}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    portal,
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-label text-[9px] tracking-[0.2em] text-primary/60 uppercase mb-1">{label}</p>
      <div className="bg-surface-variant/30 border border-primary/15 rounded px-2 py-1.5 text-on-surface">
        {children}
      </div>
    </div>
  );
}
