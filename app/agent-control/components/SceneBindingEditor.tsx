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

function parseJson(s: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = s.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid JSON" };
  }
}

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
  const [notes, setNotes] = useState<string>(binding?.notes ?? "");

  const [sampleCtxText, setSampleCtxText] = useState<string>("{}");
  const [sampleResult, setSampleResult] = useState<
    | { kind: "ok"; data: unknown }
    | { kind: "err"; message: string }
    | null
  >(null);
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
          notes: notes.trim() || null,
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
    const parsed = parseJson(sampleCtxText);
    if (!parsed.ok) {
      setSampleResult({ kind: "err", message: t.agentControl.sceneEditorSampleCtxInvalid });
      return;
    }
    setSampling(true);
    setSampleResult(null);
    try {
      const res = await fetch(`/api/scene-bindings/${encodeURIComponent(scene.key)}/sample-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ctx: parsed.value }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setSampleResult({
          kind: "err",
          message: typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
        });
      } else {
        setSampleResult({ kind: "ok", data });
      }
    } catch (e) {
      setSampleResult({ kind: "err", message: e instanceof Error ? e.message : "fetch failed" });
    } finally {
      setSampling(false);
    }
  }

  const sceneLabel = scene.label[locale] ?? scene.label.en;

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
          <div className="space-y-1">
            <div className="font-label text-[10px] tracking-[0.3em] uppercase text-primary">
              {format(t.agentControl.sceneEditorTitle, { key: scene.key })}
            </div>
            <h2 className="text-lg font-semibold text-on-surface">{sceneLabel}</h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
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

        {/* Agent picker */}
        <section className="space-y-2">
          <label className="block">
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
                className="w-full bg-surface-variant border border-primary/30 rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
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
          <p className="text-[11px] text-on-surface-variant">{t.agentControl.sceneEditorAgentHint}</p>
        </section>

        {/* Enabled + notes */}
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-start">
          <label className="flex items-center gap-2 text-sm text-on-surface select-none">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-primary"
            />
            <span>{t.agentControl.sceneEditorEnabled}</span>
          </label>
          <label className="block">
            <div className="font-label text-[10px] tracking-[0.3em] uppercase text-primary mb-1">
              {t.agentControl.sceneEditorNotes}
            </div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
              maxLength={500}
              className="w-full bg-surface-variant border border-primary/30 rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
            />
          </label>
        </div>
        <p className="text-[11px] text-on-surface-variant -mt-3">
          {t.agentControl.sceneEditorEnabledHint}
        </p>

        {/* Sample run section */}
        <section className="border-t border-primary/15 pt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
                {t.agentControl.sceneEditorSampleRun}
              </div>
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                {t.agentControl.sceneEditorSampleRunHint}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSampleRun}
              disabled={sampling || busy || !agentId}
              className="min-h-[36px] px-4 rounded border border-secondary/40 bg-secondary/[0.08] hover:bg-secondary/[0.16] text-secondary font-label text-[10px] tracking-[0.3em] uppercase transition-colors disabled:opacity-50"
            >
              {sampling ? t.agentControl.sceneEditorRunning : t.agentControl.sceneEditorRunNow}
            </button>
          </div>
          <textarea
            value={sampleCtxText}
            onChange={(e) => setSampleCtxText(e.target.value)}
            disabled={sampling || busy}
            rows={4}
            spellCheck={false}
            className="w-full bg-surface-variant border border-secondary/30 rounded px-3 py-2 font-mono text-xs text-on-surface focus:outline-none focus:border-secondary"
            aria-label={t.agentControl.sceneEditorSampleCtx}
          />
          {sampleResult ? (
            <div
              className={[
                "rounded border p-2 text-xs font-mono whitespace-pre-wrap break-all max-h-60 overflow-auto",
                sampleResult.kind === "ok"
                  ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300"
                  : "border-rose-500/40 bg-rose-500/[0.08] text-rose-300",
              ].join(" ")}
            >
              <div className="font-label text-[10px] tracking-[0.25em] uppercase mb-1">
                {sampleResult.kind === "ok"
                  ? t.agentControl.sceneEditorResultOk
                  : t.agentControl.sceneEditorResultErr}
              </div>
              {sampleResult.kind === "ok"
                ? JSON.stringify(sampleResult.data, null, 2)
                : sampleResult.message}
            </div>
          ) : null}
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
