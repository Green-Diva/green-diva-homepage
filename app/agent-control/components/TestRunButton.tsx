"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import type { AgentRow } from "../types";
import { themeClass } from "@/lib/agentControl/theme";

// Manual smoke-test trigger. Lives in the agent detail header next to
// JOBS so admin can verify a deployed agent's bound scenes without
// burning LLM credits on every deploy (the deploy-time gate was removed
// 2026-05-15 in favor of this button).
//
// Flow:
//   1. Click → modal opens with checklist of agent.boundScenes
//      (binding rows only — intent-only scenes can't be tested before
//      deploy materializes them).
//   2. Admin picks one or more scenes that have sampleCtx; scenes
//      without sampleCtx are disabled with a hint.
//   3. Click "Run selected" → POST /api/agents/[id]/test-run → modal
//      switches to running stage → results stage with per-scene
//      pass/fail + runLog tail on failure.

type RunResult = {
  sceneKey: string;
  ok: boolean;
  durationMs: number;
  skipped?: boolean;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
  runLog?: unknown;
};

type Stage = "idle" | "select" | "running" | "result";

export default function TestRunButton({
  agent,
  isAdmin,
}: {
  agent: AgentRow;
  isAdmin: boolean;
}) {
  const t = useT();
  const [stage, setStage] = useState<Stage>("idle");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);

  const accentText = themeClass(agent.mode, "text");
  const accentBorder = themeClass(agent.mode, "border");
  const accentBg = themeClass(agent.mode, "bgSoft");

  // Both "binding" (live) AND "intent" (draft claim) scenes are testable.
  // Test Run runs against the agent's pipeline directly via executeAgent —
  // it doesn't go through SceneBinding for routing — so intent claims are
  // enough to scope the test. Draft / re-drafted agents can therefore
  // smoke-test before re-deploy.
  const testableScenes = agent.boundScenes;

  function openSelect() {
    setStage("select");
    setSubmitErr(null);
    setResults([]);
    // default: pre-select every scene that has sampleCtx
    setSelected(
      new Set(testableScenes.filter((s) => s.hasSampleCtx).map((s) => s.sceneKey)),
    );
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function runSelected() {
    const sceneKeys = [...selected];
    if (sceneKeys.length === 0) return;
    setStage("running");
    setSubmitErr(null);
    try {
      const r = await fetch(`/api/agents/${agent.id}/test-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneKeys }),
      });
      const data: { ok?: boolean; results?: RunResult[]; errorMessage?: string } =
        await r.json().catch(() => ({}));
      if (!r.ok) {
        setSubmitErr(data.errorMessage ?? `test-run failed (${r.status})`);
        setStage("select");
        return;
      }
      setResults(Array.isArray(data.results) ? data.results : []);
      setStage("result");
    } catch (e) {
      setSubmitErr(`network error: ${(e as Error).message}`);
      setStage("select");
    }
  }

  function close() {
    setStage("idle");
  }

  if (!isAdmin) return null;

  return (
    <>
      <button
        type="button"
        onClick={openSelect}
        title={t.agentControl.testRunTitle}
        className="min-h-[30px] px-2.5 border border-outline-variant text-on-surface-variant font-label text-[9px] tracking-[0.25em] uppercase rounded-md hover:bg-surface-container hover:text-on-surface transition-colors flex items-center gap-1.5"
      >
        <span className="material-symbols-outlined text-[14px]" aria-hidden>
          experiment
        </span>
        {t.agentControl.testRun}
      </button>

      {stage !== "idle"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget && stage !== "running") close();
              }}
            >
              <div className="w-full max-w-xl rounded-lg border border-outline-variant/40 bg-surface-container p-6 shadow-2xl max-h-[85vh] flex flex-col">
                <h2 className={`font-label text-[12px] tracking-[0.3em] uppercase mb-3 ${accentText}`}>
                  {stage === "running"
                    ? t.agentControl.testRunRunningTitle
                    : stage === "result"
                      ? t.agentControl.testRunResultTitle
                      : t.agentControl.testRunSelectTitle}
                </h2>

                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  {stage === "select" ? (
                    <SelectBody
                      scenes={testableScenes}
                      selected={selected}
                      onToggle={toggle}
                      t={t}
                    />
                  ) : stage === "running" ? (
                    <RunningBody selected={[...selected]} t={t} />
                  ) : (
                    <ResultsBody results={results} t={t} />
                  )}
                  {submitErr ? (
                    <p className="mt-3 text-[12px] text-rose-300 font-mono">{submitErr}</p>
                  ) : null}
                </div>

                <div className="mt-5 flex justify-end gap-3 shrink-0">
                  {stage === "select" ? (
                    <>
                      <button
                        type="button"
                        onClick={close}
                        className="min-h-[40px] px-5 py-1.5 border border-outline-variant text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-surface-container/70 transition-colors"
                      >
                        {t.agentControl.cancel}
                      </button>
                      <button
                        type="button"
                        onClick={runSelected}
                        disabled={selected.size === 0}
                        className={`min-h-[40px] px-5 py-1.5 border-2 font-label text-[10px] tracking-[0.3em] uppercase rounded-md transition-colors ${accentBorder} ${accentText} ${accentBg} hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        {t.agentControl.testRunStart} ({selected.size})
                      </button>
                    </>
                  ) : stage === "running" ? null : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setStage("select");
                          setResults([]);
                        }}
                        className="min-h-[40px] px-5 py-1.5 border border-outline-variant text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-surface-container/70 transition-colors"
                      >
                        {t.agentControl.testRunBack}
                      </button>
                      <button
                        type="button"
                        onClick={close}
                        className={`min-h-[40px] px-5 py-1.5 border-2 font-label text-[10px] tracking-[0.3em] uppercase rounded-md transition-colors ${accentBorder} ${accentText} ${accentBg} hover:opacity-90`}
                      >
                        {t.agentControl.close}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function SelectBody({
  scenes,
  selected,
  onToggle,
  t,
}: {
  scenes: AgentRow["boundScenes"];
  selected: Set<string>;
  onToggle: (k: string) => void;
  t: ReturnType<typeof useT>;
}) {
  if (scenes.length === 0) {
    return (
      <p className="text-sm text-on-surface-variant">
        {t.agentControl.testRunNoBindings}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-on-surface-variant mb-3">
        {t.agentControl.testRunSelectBody}
      </p>
      <ul className="space-y-1.5">
        {scenes.map((s) => {
          const disabled = !s.hasSampleCtx;
          const checked = selected.has(s.sceneKey);
          return (
            <li key={s.sceneKey}>
              <label
                className={`flex items-start gap-2.5 px-3 py-2 rounded-md border ${
                  disabled
                    ? "border-outline-variant/30 opacity-50 cursor-not-allowed"
                    : checked
                      ? "border-primary/50 bg-primary/[0.06] cursor-pointer"
                      : "border-outline-variant/40 hover:border-primary/40 cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(s.sceneKey)}
                  className="mt-0.5 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-[12px] text-on-surface">
                      {s.sceneKey}
                    </span>
                    {disabled ? (
                      <span className="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant/60 border border-outline-variant/40 px-1 rounded">
                        {t.agentControl.testRunSkipBadge}
                      </span>
                    ) : (
                      <span className="text-[10px] tracking-[0.2em] uppercase text-emerald-300/80 border border-emerald-300/30 px-1 rounded">
                        {t.agentControl.testRunTestBadge}
                      </span>
                    )}
                    {s.via === "intent" ? (
                      <span className="text-[10px] tracking-[0.2em] uppercase text-amber-300/80 border border-amber-300/30 px-1 rounded">
                        {t.agentControl.testRunIntentBadge}
                      </span>
                    ) : null}
                    <span className="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant/50">
                      {s.invocation}
                    </span>
                  </div>
                  <div className="text-[11px] text-on-surface-variant/80 mt-0.5">
                    {s.label.zh} · {s.label.en}
                  </div>
                  {disabled ? (
                    <div className="text-[10px] text-on-surface-variant/50 mt-0.5">
                      {t.agentControl.testRunNoSampleCtx}
                    </div>
                  ) : null}
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RunningBody({
  selected,
  t,
}: {
  selected: string[];
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined animate-spin text-primary text-2xl" aria-hidden>
          progress_activity
        </span>
        <p className="text-on-surface-variant">{t.agentControl.testRunRunningBody}</p>
      </div>
      <ul className="space-y-0.5 text-[12px] font-mono text-on-surface">
        {selected.map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-300 text-[14px]" aria-hidden>
              more_horiz
            </span>
            {k}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultsBody({
  results,
  t,
}: {
  results: RunResult[];
  t: ReturnType<typeof useT>;
}) {
  const passed = results.filter((r) => r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.ok);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3 text-[12px] font-mono">
        <span className="flex items-center gap-1 text-emerald-300">
          <span className="material-symbols-outlined text-[14px]">check_circle</span>
          {passed.length}
        </span>
        <span className="flex items-center gap-1 text-rose-300">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {failed.length}
        </span>
        <span className="flex items-center gap-1 text-on-surface-variant/60">
          <span className="material-symbols-outlined text-[14px]">skip_next</span>
          {skipped.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {results.map((r) => {
          const colorClass = r.ok
            ? r.skipped
              ? "border-outline-variant/40"
              : "border-emerald-300/40 bg-emerald-300/[0.04]"
            : "border-rose-400/50 bg-rose-950/20";
          return (
            <li key={r.sceneKey} className={`rounded-md border px-3 py-2 ${colorClass}`}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-[12px] text-on-surface">{r.sceneKey}</span>
                {r.skipped ? (
                  <span className="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant/60">
                    {t.agentControl.testRunSkipBadge}
                  </span>
                ) : r.ok ? (
                  <span className="text-[10px] tracking-[0.2em] uppercase text-emerald-300">
                    PASS
                  </span>
                ) : (
                  <span className="text-[10px] tracking-[0.2em] uppercase text-rose-300">FAIL</span>
                )}
                {r.durationMs > 0 ? (
                  <span className="text-[10px] text-on-surface-variant/60">
                    ({(r.durationMs / 1000).toFixed(1)}s)
                  </span>
                ) : null}
              </div>
              {r.errorMessage ? (
                <pre className="text-[10px] font-mono text-rose-200/90 whitespace-pre-wrap break-words mt-1">
                  {r.errorCode ? `[${r.errorCode}] ` : ""}
                  {r.errorMessage}
                </pre>
              ) : null}
              {r.reason ? (
                <div className="text-[10px] text-on-surface-variant/60 mt-0.5">{r.reason}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
