"use client";

// Backbone (MECHANICAL) editor — Phase 3 MVP. Linear pipeline of skills
// drawn from the 6 equipment slots. Save writes to PUT /pipeline; Test Run
// hits POST /dry-run synchronously with the in-progress (unsaved) config.
//
// Future: Phase 5 will add a react-flow DAG canvas for branching/parallel.
// Today: linear list with up/down reorder + dropdowns for equipSlot and
// inputMapping.from.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import type { AgentRow, EquipRow } from "../types";

type Props = {
  agent: AgentRow;
  equips: EquipRow[];
  onClose: () => void;
};

type StepDraft = {
  uid: string; // React key, stable across reorder
  id: string; // saved step id ("s1", "s2", ...)
  equipSlot: number; // 0..5
  fromRef: string; // "agent.input" | "<stepId>.output"
};

type RunLog = Array<{
  stepId: string;
  skillId?: string;
  durationMs: number;
  ok: boolean;
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
}>;
type TestResult =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; output: unknown; runLog: RunLog; durationMs: number }
  | { kind: "err"; errorCode: string; errorMessage: string; runLog: RunLog; durationMs?: number };

const SLOT_COUNT = 6;
const FROM_AGENT_INPUT = "agent.input";

let uidSeq = 0;
function nextUid(): string {
  uidSeq += 1;
  return `u${Date.now().toString(36)}-${uidSeq}`;
}

// Try to parse the agent's stored pipelineConfig into editable drafts.
// Tolerant: returns empty drafts + a warning string if shape is unknown
// (legacy loose blobs from before Phase 3).
function loadDrafts(cfg: unknown): { drafts: StepDraft[]; warning: string | null } {
  if (cfg == null) return { drafts: [], warning: null };
  if (typeof cfg !== "object" || Array.isArray(cfg)) {
    return { drafts: [], warning: "Existing config has unknown shape — saving here will replace it." };
  }
  const c = cfg as Record<string, unknown>;
  if (c.version !== 1 || !Array.isArray(c.steps)) {
    return { drafts: [], warning: "Existing config is from a previous era — saving here will replace it." };
  }
  const drafts: StepDraft[] = [];
  for (const raw of c.steps) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const slot = typeof r.equipSlot === "number" ? r.equipSlot : 0;
    const mapping = (r.inputMapping as Record<string, unknown> | undefined) ?? {};
    const from = typeof mapping.from === "string" ? mapping.from : FROM_AGENT_INPUT;
    if (!id) continue;
    drafts.push({ uid: nextUid(), id, equipSlot: slot, fromRef: from });
  }
  return { drafts, warning: null };
}

function nextStepId(drafts: StepDraft[]): string {
  // Generate s{N} where N is one above the largest existing s-number.
  let max = 0;
  for (const d of drafts) {
    const m = d.id.match(/^s(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `s${max + 1}`;
}

function defaultFromRef(drafts: StepDraft[]): string {
  if (drafts.length === 0) return FROM_AGENT_INPUT;
  return `${drafts[drafts.length - 1].id}.output`;
}

function buildConfig(drafts: StepDraft[]): { version: 1; steps: Array<{ id: string; equipSlot: number; inputMapping: { from: string } }> } {
  return {
    version: 1,
    steps: drafts.map((d) => ({
      id: d.id,
      equipSlot: d.equipSlot,
      inputMapping: { from: d.fromRef },
    })),
  };
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function BackboneEditor({ agent, equips, onClose }: Props) {
  const { locale } = useI18n();
  const router = useRouter();

  const initial = useMemo(() => loadDrafts(agent.pipelineConfig), [agent.pipelineConfig]);
  const [drafts, setDrafts] = useState<StepDraft[]>(initial.drafts);
  const [legacyWarning] = useState<string | null>(initial.warning);
  const [sampleInput, setSampleInput] = useState('{ "prompt": "hello" }');
  const [busy, setBusy] = useState(false);
  const [topErr, setTopErr] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult>({ kind: "idle" });
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Slot lookup so the dropdowns can show "Slot N · <skill name>" or
  // "Slot N · empty" depending on what's currently equipped.
  const equipBySlot = useMemo(() => {
    const m = new Map<number, EquipRow>();
    for (const e of equips) {
      if (e.slotIndex !== null) m.set(e.slotIndex, e);
    }
    return m;
  }, [equips]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, busy]);

  const portal = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);
  if (!portal) return null;

  function addStep() {
    setDrafts((cur) => [
      ...cur,
      {
        uid: nextUid(),
        id: nextStepId(cur),
        equipSlot: 0,
        fromRef: defaultFromRef(cur),
      },
    ]);
  }

  function removeStep(uid: string) {
    setDrafts((cur) => cur.filter((d) => d.uid !== uid));
  }

  function moveStep(uid: string, delta: -1 | 1) {
    setDrafts((cur) => {
      const idx = cur.findIndex((d) => d.uid === uid);
      const nextIdx = idx + delta;
      if (idx < 0 || nextIdx < 0 || nextIdx >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
      return next;
    });
  }

  function updStep(uid: string, patch: Partial<StepDraft>) {
    setDrafts((cur) => cur.map((d) => (d.uid === uid ? { ...d, ...patch } : d)));
  }

  // Dropdown options for "Input from" — agent.input + every step strictly
  // before this one in the current array order. Stale refs (pointing at a
  // step that's been moved later or removed) are surfaced as a warning so
  // the user can re-select.
  function inputFromOptionsFor(currentIdx: number): Array<{ value: string; label: string }> {
    const opts = [{ value: FROM_AGENT_INPUT, label: "Agent input" }];
    for (let i = 0; i < currentIdx; i += 1) {
      opts.push({ value: `${drafts[i].id}.output`, label: `${drafts[i].id}.output` });
    }
    return opts;
  }

  function refIsValid(d: StepDraft, idx: number): boolean {
    if (d.fromRef === FROM_AGENT_INPUT) return true;
    const m = d.fromRef.match(/^([a-zA-Z0-9_-]+)\.output$/);
    if (!m) return false;
    const refId = m[1];
    for (let i = 0; i < idx; i += 1) {
      if (drafts[i].id === refId) return true;
    }
    return false;
  }

  async function onSave() {
    setBusy(true);
    setTopErr(null);
    if (drafts.length === 0) {
      setBusy(false);
      setTopErr("Add at least one step before saving.");
      return;
    }
    // Pre-flight checks the server will also run; surface them early.
    for (let i = 0; i < drafts.length; i += 1) {
      if (!refIsValid(drafts[i], i)) {
        setBusy(false);
        setTopErr(`Step ${drafts[i].id}: input "${drafts[i].fromRef}" doesn't precede this step.`);
        return;
      }
    }
    try {
      const r = await fetch(`/api/agents/${agent.id}/pipeline`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: buildConfig(drafts) }),
      });
      setBusy(false);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setTopErr(typeof j.error === "string" ? j.error : "save failed");
        return;
      }
      router.refresh();
      onClose();
    } catch (e) {
      setBusy(false);
      setTopErr(e instanceof Error ? e.message : "save failed");
    }
  }

  async function onTestRun() {
    setTest({ kind: "running" });
    let parsedInput: unknown = null;
    if (sampleInput.trim()) {
      try {
        parsedInput = JSON.parse(sampleInput);
      } catch (e) {
        setTest({
          kind: "err",
          errorCode: "INVALID_INPUT_JSON",
          errorMessage: e instanceof Error ? e.message : "invalid sample input JSON",
          runLog: [],
        });
        return;
      }
    }
    try {
      const r = await fetch(`/api/agents/${agent.id}/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: parsedInput,
          pipelineConfig: drafts.length === 0 ? null : buildConfig(drafts),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTest({
          kind: "err",
          errorCode: `HTTP_${r.status}`,
          errorMessage: typeof data.error === "string" ? data.error : "request failed",
          runLog: [],
        });
        return;
      }
      if (data.ok) {
        setTest({
          kind: "ok",
          output: data.output,
          runLog: Array.isArray(data.runLog) ? data.runLog : [],
          durationMs: data.durationMs ?? 0,
        });
      } else {
        setTest({
          kind: "err",
          errorCode: data.errorCode ?? "UNKNOWN",
          errorMessage: data.errorMessage ?? "",
          runLog: Array.isArray(data.runLog) ? data.runLog : [],
          durationMs: data.durationMs,
        });
      }
    } catch (e) {
      setTest({
        kind: "err",
        errorCode: "CLIENT_ERROR",
        errorMessage: e instanceof Error ? e.message : "fetch threw",
        runLog: [],
      });
    }
  }

  const inputCls =
    "w-full bg-surface-variant/30 border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary/60 focus:bg-surface-variant/50 transition-colors";
  const codeCls = inputCls + " font-mono text-[11px] resize-y";
  const labelCls = "font-label text-[10px] tracking-[0.25em] text-primary/70 uppercase mb-1 block";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Backbone Config · ${agent.codename}`}
      className="fixed inset-0 z-[110] flex items-stretch justify-center bg-black/85 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl my-6 mx-4">
        <div className="cyber-panel rounded-lg p-6 flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
                {agent.codename} · Backbone Config
              </p>
              <h2 className="mt-1 font-headline text-2xl text-on-surface sacred-glow">
                Pipeline (linear)
              </h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                Steps run top-to-bottom. Each step picks one equipped skill slot and where its input
                comes from.
              </p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              aria-label="close"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {legacyWarning && (
            <div className="border border-amber-300/40 bg-amber-300/[0.06] text-amber-200 text-[11px] rounded-md px-3 py-2">
              {legacyWarning}
            </div>
          )}

          {/* Slots overview */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-label tracking-[0.15em] uppercase">
            <span className="text-primary/60">Slots:</span>
            {Array.from({ length: SLOT_COUNT }).map((_, i) => {
              const e = equipBySlot.get(i);
              const skillName = e ? (locale === "zh" ? e.skill.nameZh : e.skill.nameEn) : "empty";
              const cls = e
                ? e.skill.status === "ONLINE"
                  ? "border-secondary/60 text-secondary"
                  : "border-on-surface-variant/40 text-on-surface-variant/70"
                : "border-on-surface-variant/30 text-on-surface-variant/50";
              return (
                <span
                  key={i}
                  className={`border rounded px-1.5 py-0.5 ${cls}`}
                  title={e ? `Slot ${i} · ${e.skill.nameEn} · ${e.skill.status}` : `Slot ${i} · empty`}
                >
                  {i}·{skillName.slice(0, 8)}
                </span>
              );
            })}
          </div>

          {/* Steps */}
          <div className="flex flex-col gap-2">
            <h3 className="font-label text-[11px] tracking-[0.3em] text-secondary/80 uppercase">
              Steps
            </h3>
            {drafts.length === 0 ? (
              <p className="text-on-surface-variant/70 text-sm">No steps yet — add one below.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {drafts.map((d, idx) => {
                  const e = equipBySlot.get(d.equipSlot);
                  const skillLabel = e ? (locale === "zh" ? e.skill.nameZh : e.skill.nameEn) : "⚠ empty";
                  const refOk = refIsValid(d, idx);
                  return (
                    <li key={d.uid} className="border border-primary/15 rounded-md p-3 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-primary/60 min-w-[24px]">{idx + 1}</span>
                        <span className="font-mono text-[11px] text-on-surface">{d.id}</span>
                        <span className="text-on-surface-variant/40">·</span>
                        <span className="text-[11px] text-on-surface-variant/80 truncate">{skillLabel}</span>
                        <div className="ml-auto flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => moveStep(d.uid, -1)}
                            disabled={idx === 0}
                            className="min-w-[28px] min-h-[28px] flex items-center justify-center text-on-surface-variant/60 hover:text-primary disabled:opacity-30"
                            aria-label="move up"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStep(d.uid, 1)}
                            disabled={idx === drafts.length - 1}
                            className="min-w-[28px] min-h-[28px] flex items-center justify-center text-on-surface-variant/60 hover:text-primary disabled:opacity-30"
                            aria-label="move down"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeStep(d.uid)}
                            className="min-w-[28px] min-h-[28px] flex items-center justify-center text-error/60 hover:text-error"
                            aria-label="remove step"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={labelCls}>Slot (skill)</label>
                          <select
                            value={d.equipSlot}
                            onChange={(ev) => updStep(d.uid, { equipSlot: Number(ev.target.value) })}
                            className={inputCls}
                          >
                            {Array.from({ length: SLOT_COUNT }).map((_, i) => {
                              const slot = equipBySlot.get(i);
                              const label = slot
                                ? `Slot ${i} · ${(locale === "zh" ? slot.skill.nameZh : slot.skill.nameEn)}${slot.skill.status === "OFFLINE" ? " (OFFLINE)" : ""}`
                                : `Slot ${i} · empty`;
                              return (
                                <option key={i} value={i}>
                                  {label}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>Input from</label>
                          <select
                            value={d.fromRef}
                            onChange={(ev) => updStep(d.uid, { fromRef: ev.target.value })}
                            className={inputCls + (refOk ? "" : " border-error/60")}
                          >
                            {inputFromOptionsFor(idx).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                            {!refOk && (
                              <option value={d.fromRef} disabled>
                                {d.fromRef} (invalid)
                              </option>
                            )}
                          </select>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              onClick={addStep}
              className="self-start min-h-[36px] px-4 border border-dashed border-primary/40 text-primary/80 font-label text-[10px] tracking-[0.25em] uppercase rounded-md hover:bg-primary/[0.08] transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Add step
            </button>
          </div>

          {/* Test Run */}
          <div className="border-t border-primary/15 pt-4 flex flex-col gap-2">
            <h3 className="font-label text-[11px] tracking-[0.3em] text-secondary/80 uppercase">Test Run</h3>
            <p className="font-label text-[9px] tracking-[0.15em] text-on-surface-variant/60">
              Runs the pipeline above synchronously against your sample input. Uses unsaved edits.
            </p>
            <label className={labelCls}>Sample Input (JSON)</label>
            <textarea
              rows={3}
              value={sampleInput}
              onChange={(ev) => setSampleInput(ev.target.value)}
              className={codeCls}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={onTestRun}
              disabled={test.kind === "running" || drafts.length === 0}
              className="self-start cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[36px] px-4 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[14px]">play_arrow</span>
              {test.kind === "running" ? "Running…" : "Test Run"}
            </button>
            {test.kind === "ok" && (
              <div className="mt-2 border border-emerald-400/30 rounded p-3 bg-emerald-400/[0.05] text-[11px]">
                <p className="font-label text-[10px] tracking-[0.25em] text-emerald-300 uppercase">
                  ✓ OK · {formatDuration(test.durationMs)}
                </p>
                {test.runLog.length > 0 && <RunLogTrace log={test.runLog} />}
                <details className="mt-2">
                  <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer text-primary/70">
                    final output
                  </summary>
                  <pre className="mt-1 font-mono text-[10px] whitespace-pre-wrap break-all max-h-32 overflow-auto">
                    {JSON.stringify(test.output, null, 2)}
                  </pre>
                </details>
              </div>
            )}
            {test.kind === "err" && (
              <div className="mt-2 border border-error/40 rounded p-3 bg-error/[0.05] text-[11px]">
                <p className="font-label text-[10px] tracking-[0.25em] text-error uppercase">
                  ✗ {test.errorCode}
                  {test.durationMs !== undefined ? ` · ${formatDuration(test.durationMs)}` : ""}
                </p>
                <p className="mt-1 text-error/80 whitespace-pre-wrap break-all">{test.errorMessage}</p>
                {test.runLog.length > 0 && <RunLogTrace log={test.runLog} />}
              </div>
            )}
          </div>

          {topErr && <p className="text-error text-sm">{topErr}</p>}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-primary/10">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface min-h-[44px] px-4"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[44px] px-6"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portal,
  );
}

function RunLogTrace({ log }: { log: RunLog }) {
  return (
    <details className="mt-2" open>
      <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer text-primary/70">
        run log · {log.length} step(s)
      </summary>
      <ol className="mt-1 flex flex-col gap-1">
        {log.map((entry, i) => (
          <li
            key={i}
            className={`font-mono text-[10px] px-2 py-1 rounded border ${entry.ok ? "border-emerald-400/30 bg-emerald-400/[0.04] text-emerald-300/90" : "border-error/30 bg-error/[0.04] text-error/90"}`}
          >
            <div className="flex items-center gap-2">
              <span>{entry.ok ? "✓" : "✗"}</span>
              <span>{entry.stepId}</span>
              <span className="text-on-surface-variant/50">· {entry.durationMs}ms</span>
              {entry.errorCode && <span className="ml-auto text-error/80">{entry.errorCode}</span>}
            </div>
            {entry.errorMessage && (
              <p className="mt-0.5 text-error/80 whitespace-pre-wrap break-all">{entry.errorMessage}</p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
