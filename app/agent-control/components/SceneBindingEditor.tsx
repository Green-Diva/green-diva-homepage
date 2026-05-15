"use client";

// Edit one SceneBinding row: pick which agent satisfies it, toggle
// enabled, write notes, and dry-run with a sample ctx — all without
// touching code.
//
// 2026-05-12 — inputMap retired. ctx → agent.input is owned by
// `scene.prepareAgentInput` in code (lib/relics/scenes.ts). Admin only
// edits routing here (which agent + enabled + notes).
//
// Output shape: NOT editable here. The scene's outputSchema (declared
// in code) is the contract; the bound agent must produce that shape via
// its tail node. The Scene contract panel below is read-only and shows
// the schema fields admin needs to satisfy.
//
// Structure mirrors SkillEditor: portal-mounted full-screen overlay,
// ESC + body overflow lock, single Save button posting to PATCH
// /api/scene-bindings/[sceneKey]. Sample Run hits a dedicated dry-run
// endpoint so we don't risk persisting via the regular dispatch path.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type {
  SceneBindingRow,
  SerializableSceneDef,
  AgentPickerOption,
} from "../types";

type Props = {
  scene: SerializableSceneDef;
  binding: SceneBindingRow | null;
  agents: AgentPickerOption[];
  onClose: () => void;
  onSaved: () => void;
};

// Match-on-superset: an agent qualifies iff its capability list contains
// every tag the scene requires. Empty required → every agent qualifies.
function agentSatisfies(agent: AgentPickerOption, required: string[]): boolean {
  if (required.length === 0) return true;
  const have = new Set(agent.capabilities);
  return required.every((c) => have.has(c));
}

export default function SceneBindingEditor({
  scene,
  binding,
  agents,
  onClose,
  onSaved,
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();

  const [agentId, setAgentId] = useState<string>(binding?.agentId ?? "");
  const [enabled, setEnabled] = useState<boolean>(binding?.enabled ?? true);
  // Seed customLabel / notes from the scene's code-level label & description
  // when the binding has no override yet. Keeps the editor consistent with the
  // list view (which already falls back to code) — admin sees the same text
  // they see in the list, can edit or keep it, and SAVE writes it to DB.
  const codeLabelFallback = scene.label[locale] ?? scene.label.en;
  const codeDescriptionFallback =
    scene.description?.[locale] ?? scene.description?.en ?? "";
  const [customLabel, setCustomLabel] = useState<string>(
    binding?.customLabel ?? codeLabelFallback,
  );
  const [notes, setNotes] = useState<string>(
    binding?.notes ?? codeDescriptionFallback,
  );
  const [editingLabel, setEditingLabel] = useState<boolean>(false);
  const [editingNotes, setEditingNotes] = useState<boolean>(false);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingLabel) labelInputRef.current?.focus();
  }, [editingLabel]);
  useEffect(() => {
    if (editingNotes) notesInputRef.current?.focus();
  }, [editingNotes]);

  // SAMPLE RUN result. Reuses the agent-level test-run endpoint
  // (POST /api/agents/[id]/test-run with the single sceneKey), so the
  // scene's built-in sampleCtx drives the run — no admin JSON input.
  type SampleRunResult = {
    ok: boolean;
    durationMs: number;
    skipped?: boolean;
    reason?: string;
    errorCode?: string;
    errorMessage?: string;
    output?: unknown;
    runLog?: unknown;
  };
  const [sampleResult, setSampleResult] = useState<SampleRunResult | null>(null);
  const [sampling, setSampling] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const closeBtnRef = useRef<HTMLButtonElement>(null);

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
  }, [busy, onClose]);

  const candidateAgents = useMemo(
    () =>
      agents
        .filter((a) => !!a.deployedAt && agentSatisfies(a, scene.requiredCapabilities))
        .sort((a, b) => a.codename.localeCompare(b.codename)),
    [agents, scene.requiredCapabilities],
  );

  // If the currently bound agent is no longer in the candidate list (it
  // got undeployed or lost a required capability tag), still show it as
  // selectable so admin can either re-deploy/re-tag it or pick a new one
  // explicitly. Without this, the dropdown silently switches to the first
  // candidate which is surprising.
  const selectableAgents = useMemo(() => {
    if (!agentId) return candidateAgents;
    if (candidateAgents.some((a) => a.id === agentId)) return candidateAgents;
    const stale = agents.find((a) => a.id === agentId);
    return stale ? [stale, ...candidateAgents] : candidateAgents;
  }, [agentId, agents, candidateAgents]);

  const canSave = !!agentId && !busy;

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/scene-bindings/${encodeURIComponent(scene.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          enabled,
          customLabel: customLabel.trim() === "" ? null : customLabel.trim(),
          notes: notes.trim() === "" ? null : notes.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      router.refresh();
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.agentControl.saveFailed);
      setBusy(false);
    }
  }

  async function handleSampleRun() {
    if (!agentId) return;
    setSampling(true);
    setSampleResult(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/test-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneKeys: [scene.key] }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        results?: SampleRunResult[];
        errorMessage?: string;
      };
      if (!res.ok) {
        setSampleResult({
          ok: false,
          durationMs: 0,
          errorCode: "TEST_RUN_FAILED",
          errorMessage: data.errorMessage ?? `HTTP ${res.status}`,
        });
      } else {
        const first = Array.isArray(data.results) ? data.results[0] : null;
        setSampleResult(
          first ?? {
            ok: false,
            durationMs: 0,
            errorCode: "TEST_RUN_FAILED",
            errorMessage: "test-run returned no results",
          },
        );
      }
    } catch (e) {
      setSampleResult({
        ok: false,
        durationMs: 0,
        errorCode: "NETWORK_ERROR",
        errorMessage: e instanceof Error ? e.message : "fetch failed",
      });
    } finally {
      setSampling(false);
    }
  }

  const codeLabel = codeLabelFallback;

  const node = (
    <div
      className="fixed inset-0 z-[1000] bg-background/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-lg border border-primary/30 bg-surface p-5 space-y-5 shadow-2xl">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 pb-3 border-b border-primary/15">
          <div className="space-y-2.5 flex-1 min-w-0">
            <div className="font-label text-[10px] tracking-[0.3em] uppercase text-primary">
              {format(t.agentControl.sceneEditorTitle, { key: scene.key })}
            </div>

            {/* Scene name row — display vs edit toggled by pencil */}
            <div className="space-y-1">
              <div className="font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant">
                {t.agentControl.sceneEditorSceneName}
              </div>
              {editingLabel ? (
                <div className="flex items-baseline gap-2">
                  <input
                    ref={labelInputRef}
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    onBlur={() => setEditingLabel(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") {
                        e.preventDefault();
                        setEditingLabel(false);
                      }
                    }}
                    placeholder={codeLabel}
                    maxLength={30}
                    disabled={busy}
                    className="flex-1 min-w-0 bg-transparent text-lg font-semibold text-on-surface placeholder:text-on-surface/60 border-0 border-b border-primary/60 focus:outline-none px-0 py-0.5 transition-colors disabled:opacity-50"
                  />
                  {customLabel.length > 0 ? (
                    <span className="text-[11px] font-mono text-on-surface-variant shrink-0">
                      {customLabel.length}/30
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="flex-1 min-w-0 text-lg font-semibold text-on-surface truncate">
                    {customLabel.trim() || codeLabel}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setEditingLabel(true)}
                    disabled={busy}
                    className="shrink-0 material-symbols-outlined text-[18px] text-on-surface-variant hover:text-primary transition-colors disabled:opacity-50"
                    aria-label={t.agentControl.sceneEditorEditLabel}
                    title={t.agentControl.sceneEditorEditLabel}
                  >
                    edit
                  </button>
                </div>
              )}
              {editingLabel ? (
                <p className="text-[10px] text-on-surface-variant">
                  {format(t.agentControl.sceneEditorCustomLabelHint, { label: codeLabel })}
                </p>
              ) : null}
            </div>

            {/* Notes row — same pattern */}
            <div className="space-y-1">
              <div className="font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant">
                {t.agentControl.sceneEditorNotes}
              </div>
              {editingNotes ? (
                <div className="flex items-baseline gap-2">
                  <input
                    ref={notesInputRef}
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => setEditingNotes(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") {
                        e.preventDefault();
                        setEditingNotes(false);
                      }
                    }}
                    maxLength={80}
                    disabled={busy}
                    className="flex-1 min-w-0 bg-transparent text-sm text-on-surface border-0 border-b border-primary/60 focus:outline-none px-0 py-0.5 transition-colors disabled:opacity-50"
                  />
                  {notes.length > 0 ? (
                    <span className="text-[11px] font-mono text-on-surface-variant shrink-0">
                      {notes.length}/80
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span
                    className={`flex-1 min-w-0 text-sm truncate ${
                      notes.trim()
                        ? "text-on-surface"
                        : "text-on-surface-variant/60 italic"
                    }`}
                  >
                    {notes.trim() || t.agentControl.sceneEditorNotesEmpty}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingNotes(true)}
                    disabled={busy}
                    className="shrink-0 material-symbols-outlined text-[18px] text-on-surface-variant hover:text-primary transition-colors disabled:opacity-50"
                    aria-label={t.agentControl.sceneEditorEditNotes}
                    title={t.agentControl.sceneEditorEditNotes}
                  >
                    edit
                  </button>
                </div>
              )}
              {editingNotes ? (
                <p className="text-[10px] text-on-surface-variant">
                  {t.agentControl.sceneEditorNotesHint}
                </p>
              ) : null}
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="shrink-0 material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
            aria-label={t.agentControl.cancel}
          >
            close
          </button>
        </header>

        {/* Schema reference — context (caller input) + output (agent contract) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <FieldList
            title={t.agentControl.sceneEditorContextFields}
            fields={scene.contextFields}
          />
          <FieldList
            title={t.agentControl.sceneEditorOutputFields}
            fields={scene.outputFields}
            badge="contract"
          />
        </div>
        <p className="text-[11px] text-on-surface-variant -mt-3">
          📐 The output column is the scene contract — declared in code, not
          editable here. The bound agent&apos;s leaf node must produce this
          shape (typically via a tail{" "}
          <code className="text-primary">transform</code> node in the
          BackboneFlowEditor).
        </p>

        {/* Agent picker + Enabled toggle (inline, vertically centered on
            the input row 2026-05-15). Right column mirrors the label
            height with an invisible spacer so the toggle sits exactly
            at the dropdown's vertical center. */}
        <section className="space-y-2">
          <div className="flex items-stretch gap-3">
            <label className="block flex-1 min-w-0">
              <div className="font-label text-[10px] tracking-[0.3em] uppercase text-primary mb-1">
                {t.agentControl.sceneEditorAgent}
              </div>
              {candidateAgents.length === 0 && selectableAgents.length === 0 ? (
                <div className="text-xs text-amber-400 bg-amber-500/[0.08] border border-amber-500/30 rounded p-2">
                  {t.agentControl.sceneEditorAgentMissing}
                </div>
              ) : (
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  disabled={busy}
                  className="w-full h-[44px] bg-surface-variant border border-primary/30 rounded px-3 text-sm text-on-surface focus:outline-none focus:border-primary"
                >
                  <option value="" disabled>
                    —
                  </option>
                  {selectableAgents.map((a) => {
                    const stale =
                      !a.deployedAt || !agentSatisfies(a, scene.requiredCapabilities);
                    return (
                      <option key={a.id} value={a.id}>
                        {a.codename}
                        {stale ? "  (not deployed / missing capability)" : ""}
                      </option>
                    );
                  })}
                </select>
              )}
            </label>
            <div className="shrink-0 flex flex-col">
              {/* Invisible spacer that matches the dropdown's "AGENT"
                  label height (mb-1 + label line) so the toggle lines up
                  centered on the dropdown row below. */}
              <div aria-hidden className="font-label text-[10px] tracking-[0.3em] uppercase mb-1 invisible">
                .
              </div>
              {/* Segmented toggle: ENABLED (emerald) | DISABLED (rose),
                  active side filled, inactive outlined. */}
              <div
                role="radiogroup"
                aria-label={t.agentControl.sceneEditorEnabled}
                className="inline-flex rounded-md border border-outline-variant overflow-hidden font-label text-[10px] tracking-[0.3em] uppercase"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={enabled}
                  disabled={busy}
                  onClick={() => setEnabled(true)}
                  className={`h-[44px] px-4 transition-colors flex items-center gap-1.5 disabled:opacity-40 ${
                    enabled
                      ? "bg-emerald-400/[0.12] text-emerald-300 border-r border-emerald-400/50"
                      : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container/70 border-r border-outline-variant"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`material-symbols-outlined text-[14px] ${enabled ? "text-emerald-300" : "text-on-surface-variant/50"}`}
                  >
                    {enabled ? "check_circle" : "radio_button_unchecked"}
                  </span>
                  {t.agentControl.sceneEditorToggleEnabled}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!enabled}
                  disabled={busy}
                  onClick={() => setEnabled(false)}
                  className={`h-[44px] px-4 transition-colors flex items-center gap-1.5 disabled:opacity-40 ${
                    !enabled
                      ? "bg-rose-400/[0.12] text-rose-300"
                      : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container/70"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`material-symbols-outlined text-[14px] ${!enabled ? "text-rose-300" : "text-on-surface-variant/50"}`}
                  >
                    {!enabled ? "block" : "radio_button_unchecked"}
                  </span>
                  {t.agentControl.sceneEditorToggleDisabled}
                </button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-on-surface-variant">
            {t.agentControl.sceneEditorAgentHint} · {t.agentControl.sceneEditorEnabledHint}
          </p>
        </section>

        {/* Sample run section. Reuses the agent-level test-run flow
            (POST /api/agents/[id]/test-run) but scoped to this single
            scene against its currently-bound agent. The scene's sampleCtx
            (declared in lib/relics/scenes.ts) drives the run — admin
            doesn't supply JSON. Result + runLog tail render inline below. */}
        <section className="border-t border-primary/15 pt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
              {t.agentControl.sceneEditorSampleRun}
            </div>
            {!scene.hasSampleCtx ? (
              <span className="font-label text-[9px] tracking-[0.2em] uppercase text-amber-300 border border-amber-300/50 bg-amber-300/[0.08] rounded px-1.5 py-0.5 flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]" aria-hidden>
                  warning
                </span>
                {t.agentControl.sceneEditorSampleRunMissingBadge}
              </span>
            ) : null}
          </div>
          <div className="flex items-stretch justify-between gap-3">
            <p
              className={`text-[11px] min-w-0 flex-1 ${
                scene.hasSampleCtx ? "text-on-surface-variant" : "text-amber-200/90"
              }`}
            >
              {scene.hasSampleCtx
                ? t.agentControl.sceneEditorSampleRunHint
                : t.agentControl.sceneEditorSampleRunNoCtx}
            </p>
            <button
              type="button"
              onClick={handleSampleRun}
              disabled={sampling || busy || !agentId || !scene.hasSampleCtx}
              className="self-stretch h-auto px-4 rounded border border-secondary/40 bg-secondary/[0.08] hover:bg-secondary/[0.16] text-secondary font-label text-[10px] tracking-[0.3em] uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shrink-0"
            >
              {sampling ? (
                <span className="material-symbols-outlined animate-spin text-[14px]" aria-hidden>
                  progress_activity
                </span>
              ) : (
                <span className="material-symbols-outlined text-[14px]" aria-hidden>
                  play_arrow
                </span>
              )}
              {sampling ? t.agentControl.sceneEditorRunning : t.agentControl.sceneEditorRunNow}
            </button>
          </div>
          {sampleResult ? <SampleResultPanel result={sampleResult} t={t} /> : null}
        </section>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 pt-3 border-t border-primary/15">
          <div className="text-xs text-rose-400 flex-1 min-h-[1em]">{err}</div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[36px] px-4 rounded border border-on-surface-variant/30 text-on-surface-variant hover:bg-on-surface-variant/[0.08] font-label text-[10px] tracking-[0.3em] uppercase transition-colors disabled:opacity-50"
          >
            {t.agentControl.cancel}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="min-h-[36px] px-5 rounded border border-primary/40 bg-primary/[0.08] hover:bg-primary/[0.16] text-primary font-label text-[10px] tracking-[0.3em] uppercase transition-colors disabled:opacity-50"
          >
            {busy ? t.agentControl.saving : t.agentControl.save}
          </button>
        </footer>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}

function FieldList({
  title,
  fields,
  badge,
}: {
  title: string;
  fields: { name: string; type: string; optional: boolean }[];
  badge?: string;
}) {
  return (
    <div className="rounded border border-primary/15 bg-primary/[0.03] p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant">
          {title}
        </div>
        {badge ? (
          <span className="font-label text-[9px] tracking-[0.2em] uppercase text-secondary border border-secondary/40 rounded px-1.5 py-0.5">
            {badge}
          </span>
        ) : null}
      </div>
      {fields.length === 0 ? (
        <div className="text-[11px] text-on-surface-variant italic">unknown</div>
      ) : (
        <ul className="space-y-0.5">
          {fields.map((f) => (
            <li key={f.name} className="font-mono text-[11px] text-on-surface flex gap-2">
              <span className="text-primary">{f.name}</span>
              <span className="text-on-surface-variant">:</span>
              <span className="text-on-surface-variant">{f.type}</span>
              {f.optional ? <span className="text-amber-400">?</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Inline result panel for sample-run inside SceneBindingEditor. Shows the
// per-scene test-run outcome — status pill, duration, errorMessage (on
// failure) or output JSON (on success), plus the runLog tail when present.
function SampleResultPanel({
  result,
  t,
}: {
  result: {
    ok: boolean;
    durationMs: number;
    skipped?: boolean;
    reason?: string;
    errorCode?: string;
    errorMessage?: string;
    output?: unknown;
    runLog?: unknown;
  };
  t: ReturnType<typeof useT>;
}) {
  const tone = result.skipped
    ? "border-outline-variant/40 bg-surface-container/30"
    : result.ok
      ? "border-emerald-400/40 bg-emerald-400/[0.06]"
      : "border-rose-400/50 bg-rose-950/20";
  const badgeTone = result.skipped
    ? "text-on-surface-variant border-outline-variant/40"
    : result.ok
      ? "text-emerald-300 border-emerald-400/40"
      : "text-rose-300 border-rose-400/40";
  const tailLog = Array.isArray(result.runLog)
    ? (result.runLog as Array<Record<string, unknown>>).slice(-3)
    : [];
  return (
    <div className={`rounded border p-3 space-y-2 ${tone}`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={`font-label text-[10px] tracking-[0.3em] uppercase border rounded px-1.5 py-0.5 ${badgeTone}`}
        >
          {result.skipped
            ? t.agentControl.sceneEditorResultSkip
            : result.ok
              ? t.agentControl.sceneEditorResultOk
              : t.agentControl.sceneEditorResultErr}
        </span>
        {result.durationMs > 0 ? (
          <span className="text-[11px] font-mono text-on-surface-variant">
            {(result.durationMs / 1000).toFixed(2)}s
          </span>
        ) : null}
        {result.errorCode ? (
          <span className="text-[10px] font-mono text-rose-300">[{result.errorCode}]</span>
        ) : null}
      </div>
      {result.reason ? (
        <p className="text-[11px] text-on-surface-variant">{result.reason}</p>
      ) : null}
      {result.errorMessage ? (
        <pre className="text-[11px] font-mono text-rose-200/90 whitespace-pre-wrap break-words bg-rose-950/40 border border-rose-400/20 rounded p-2 max-h-40 overflow-auto">
          {result.errorMessage}
        </pre>
      ) : null}
      {tailLog.length > 0 ? (
        <div className="space-y-1">
          <div className="font-label text-[9px] tracking-[0.25em] uppercase text-on-surface-variant/70">
            {t.agentControl.sceneEditorResultRunLog}
          </div>
          <ul className="space-y-1 text-[11px] font-mono">
            {tailLog.map((entry, i) => {
              const stepId = String(entry.stepId ?? "?");
              const okStep = entry.ok === true;
              const errCode = entry.errorCode ? String(entry.errorCode) : null;
              const errMsg = entry.errorMessage ? String(entry.errorMessage) : null;
              return (
                <li
                  key={`${stepId}-${i}`}
                  className={`rounded border px-2 py-1.5 ${
                    okStep
                      ? "border-emerald-400/30 text-on-surface-variant/80"
                      : "border-rose-400/40 text-rose-200/90 bg-rose-950/20"
                  }`}
                >
                  <div className="font-semibold">
                    {okStep ? "✓ " : "✗ "}
                    {stepId}
                  </div>
                  {errCode || errMsg ? (
                    <div className="text-[10px] mt-0.5">
                      {errCode ? `[${errCode}] ` : ""}
                      {errMsg}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {result.ok && !result.skipped && result.output !== undefined ? (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-on-surface-variant hover:text-on-surface font-label text-[9px] tracking-[0.25em] uppercase">
            {t.agentControl.sceneEditorResultOutput}
          </summary>
          <pre className="mt-1 font-mono text-emerald-200/90 whitespace-pre-wrap break-words bg-emerald-950/30 border border-emerald-400/20 rounded p-2 max-h-60 overflow-auto">
            {JSON.stringify(result.output, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
