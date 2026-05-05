"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { AgentRow, AgentProvider, AgentStatus, AgentMode } from "../types";

type Mode = "create" | "edit";

type Props = {
  mode: Mode;
  initial: AgentRow | null;
  onClose: () => void;
  onSaved: () => void;
};

const PROVIDERS: AgentProvider[] = ["ECHO", "INTERNAL", "ANTHROPIC", "OPENAI"];
const STATUSES: AgentStatus[] = ["ONLINE", "STANDBY", "OFFLINE"];
const MODES: AgentMode[] = ["MECHANICAL", "AUTONOMOUS"];

const inputCls =
  "mt-1 w-full rounded-md border border-primary/20 bg-surface-container px-3 py-2 text-sm text-on-surface focus:border-primary/60 focus:outline-none";
const labelCls = "text-[10px] font-label uppercase tracking-[0.25em] text-primary/60";

function blankFromInitial(initial: AgentRow | null) {
  return {
    codename: initial?.codename ?? "",
    nameEn: initial?.nameEn ?? "",
    nameZh: initial?.nameZh ?? "",
    classification: initial?.classification ?? "",
    mode: (initial?.mode ?? "MECHANICAL") as AgentMode,
    status: (initial?.status ?? "STANDBY") as AgentStatus,
    avatarUrl: initial?.avatarUrl ?? "",
    descriptionEn: initial?.descriptionEn ?? "",
    descriptionZh: initial?.descriptionZh ?? "",
    syncLevel: initial?.syncLevel ?? 0,
    matrixLevel: initial?.matrixLevel ?? 1,
    chaosLevel: initial?.chaosLevel ?? 0,
    costTier: initial?.costTier ?? 0,
    activityLevel: initial?.activityLevel ?? 0,
    stabilityLevel: initial?.stabilityLevel ?? 0,
    availableAp: initial?.availableAp ?? 0,
    enabled: initial?.enabled ?? true,
    provider: (initial?.provider ?? "ECHO") as AgentProvider,
    model: initial?.model ?? "",
    systemPrompt: initial?.systemPrompt ?? "",
    internalHandler: initial?.internalHandler ?? "",
    inputSchemaJson: initial?.inputSchemaJson ?? "",
    outputSchemaJson: initial?.outputSchemaJson ?? "",
    maxTokens: initial?.maxTokens ?? 1024,
    temperature: initial?.temperature ?? 0.7,
    rateLimitPerMin: initial?.rateLimitPerMin ?? 20,
  };
}

export default function AgentEditor({ mode, initial, onClose, onSaved }: Props) {
  const t = useT();
  const [values, setValues] = useState(() => blankFromInitial(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

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

  const portal = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);
  if (!portal) return null;

  function update<K extends keyof typeof values>(key: K, v: (typeof values)[K]) {
    setValues((s) => ({ ...s, [key]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    if (!values.avatarUrl.trim()) {
      setBusy(false);
      setErr(t.machineAgent.avatarRequired);
      return;
    }

    const body: Record<string, unknown> = {
      codename: values.codename.trim(),
      nameEn: values.nameEn.trim(),
      nameZh: values.nameZh.trim(),
      classification: values.classification.trim() || null,
      mode: values.mode,
      status: values.status,
      avatarUrl: values.avatarUrl.trim(),
      descriptionEn: values.descriptionEn.trim() || null,
      descriptionZh: values.descriptionZh.trim() || null,
      syncLevel: Number(values.syncLevel),
      matrixLevel: Number(values.matrixLevel),
      chaosLevel: Number(values.chaosLevel),
      costTier: Number(values.costTier),
      activityLevel: Number(values.activityLevel),
      stabilityLevel: Number(values.stabilityLevel),
      availableAp: Number(values.availableAp),
      enabled: !!values.enabled,
      provider: values.provider,
      model: values.model.trim() || null,
      systemPrompt: values.systemPrompt.trim() || null,
      internalHandler: values.internalHandler.trim() || null,
      inputSchemaJson: values.inputSchemaJson.trim() || null,
      outputSchemaJson: values.outputSchemaJson.trim() || null,
      maxTokens: Number(values.maxTokens) || null,
      temperature: Number(values.temperature),
      rateLimitPerMin: Number(values.rateLimitPerMin) || null,
    };
    if (mode === "create" && !body.codename) {
      setBusy(false);
      setErr("codename is required");
      return;
    }

    const url = mode === "create" ? "/api/agents" : `/api/agents/${initial?.id}`;
    const httpMethod = mode === "create" ? "POST" : "PATCH";
    const r = await fetch(url, {
      method: httpMethod,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : JSON.stringify(j.error ?? r.statusText));
      return;
    }
    onSaved();
    onClose();
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(format(t.machineAgent.confirmRemove, { name: initial.codename }))) return;
    const r = await fetch(`/api/agents/${initial.id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`${t.machineAgent.deleteFailed}: ${j.error ?? r.statusText}`);
      return;
    }
    onSaved();
    onClose();
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "create" ? t.machineAgent.editorNewTitle : t.machineAgent.editorEditTitle}
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/85 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-3xl my-6 mx-4 cyber-panel rounded-lg p-6 sm:p-8 space-y-6"
      >
        <span aria-hidden className="tech-marker-tl" />
        <span aria-hidden className="tech-marker-br" />

        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="font-label text-[10px] tracking-[0.3em] text-secondary uppercase">
              {mode === "create" ? t.machineAgent.editorNewLabel : t.machineAgent.editorEditLabel}
            </span>
            <h2 className="mt-1 font-headline text-3xl text-primary sacred-glow">
              {mode === "create" ? t.machineAgent.editorNewTitle : t.machineAgent.editorEditTitle}
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-on-surface-variant hover:text-primary"
            aria-label={t.machineAgent.cancel}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block sm:col-span-2">
            <span className={labelCls}>{t.machineAgent.fieldCodename}</span>
            <input
              className={inputCls}
              value={values.codename}
              onChange={(e) => update("codename", e.target.value.toUpperCase())}
              required
              maxLength={32}
              pattern="[A-Z0-9-]+"
              disabled={mode === "edit"}
            />
          </label>
          <label className="block">
            <span className={labelCls}>{t.machineAgent.fieldNameEn}</span>
            <input className={inputCls} value={values.nameEn} onChange={(e) => update("nameEn", e.target.value)} required />
          </label>
          <label className="block">
            <span className={labelCls}>{t.machineAgent.fieldNameZh}</span>
            <input className={inputCls} value={values.nameZh} onChange={(e) => update("nameZh", e.target.value)} required />
          </label>
          <label className="block">
            <span className={labelCls}>Mode</span>
            <select className={inputCls} value={values.mode} onChange={(e) => update("mode", e.target.value as AgentMode)}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m === "MECHANICAL" ? t.machineAgent.modeMechanical : t.machineAgent.modeAutonomous}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>{t.machineAgent.fieldClassification}</span>
            <input className={inputCls} value={values.classification} onChange={(e) => update("classification", e.target.value)} />
          </label>
          <label className="block">
            <span className={labelCls}>{t.machineAgent.fieldStatus}</span>
            <select className={inputCls} value={values.status} onChange={(e) => update("status", e.target.value as AgentStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>{t.machineAgent.fieldAvatar} *</span>
            <input
              className={inputCls}
              type="url"
              value={values.avatarUrl}
              onChange={(e) => update("avatarUrl", e.target.value)}
              placeholder="https://…"
              required
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>{t.machineAgent.fieldDescriptionZh}</span>
            <textarea className={`${inputCls} min-h-[60px]`} value={values.descriptionZh} onChange={(e) => update("descriptionZh", e.target.value)} maxLength={4000} />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>{t.machineAgent.fieldDescriptionEn}</span>
            <textarea className={`${inputCls} min-h-[60px]`} value={values.descriptionEn} onChange={(e) => update("descriptionEn", e.target.value)} maxLength={4000} />
          </label>
          <label className="block">
            <span className={labelCls}>{t.machineAgent.fieldSyncLevel}</span>
            <input className={inputCls} type="number" min={0} max={100} step={0.1} value={values.syncLevel} onChange={(e) => update("syncLevel", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className={labelCls}>{t.machineAgent.fieldMatrixLevel}</span>
            <input className={inputCls} type="number" min={1} max={99} value={values.matrixLevel} onChange={(e) => update("matrixLevel", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className={labelCls}>{t.machineAgent.fieldAvailableAp}</span>
            <input className={inputCls} type="number" min={0} max={999} value={values.availableAp} onChange={(e) => update("availableAp", Number(e.target.value))} />
          </label>
        </div>

        <fieldset className="border border-primary/15 rounded-md p-4 space-y-3">
          <legend className="px-2 font-label text-[10px] tracking-[0.3em] text-secondary uppercase">
            {t.machineAgent.fieldStatsHeading}
          </legend>
          <p className="text-[11px] text-on-surface-variant opacity-70">
            {/* TODO: 4 derived stats — left editable for admin testing only. */}
            ⏳ pending derivation algorithm
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(
              [
                ["chaosLevel", t.machineAgent.statChaos],
                ["costTier", t.machineAgent.statCost],
                ["activityLevel", t.machineAgent.statActivity],
                ["stabilityLevel", t.machineAgent.statStability],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className={labelCls}>{label}</span>
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={100}
                  value={values[key] as number}
                  onChange={(e) => update(key, Number(e.target.value) as never)}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="border border-primary/15 rounded-md p-4 space-y-3">
          <legend className="px-2 font-label text-[10px] tracking-[0.3em] text-secondary uppercase">
            {t.machineAgent.fieldRuntimeHeading}
          </legend>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-3 self-end pb-2">
              <input
                type="checkbox"
                checked={values.enabled}
                onChange={(e) => update("enabled", e.target.checked)}
                className="w-5 h-5 accent-primary"
              />
              <span className={labelCls}>{t.machineAgent.fieldEnabled}</span>
            </label>
            <label className="block">
              <span className={labelCls}>{t.machineAgent.fieldProvider}</span>
              <select className={inputCls} value={values.provider} onChange={(e) => update("provider", e.target.value as AgentProvider)}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>{t.machineAgent.fieldModel}</span>
              <input className={inputCls} value={values.model} onChange={(e) => update("model", e.target.value)} />
            </label>
            <label className="block">
              <span className={labelCls}>{t.machineAgent.fieldInternalHandler}</span>
              <input className={inputCls} value={values.internalHandler} onChange={(e) => update("internalHandler", e.target.value)} />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>{t.machineAgent.fieldSystemPrompt}</span>
              <textarea className={`${inputCls} min-h-[60px]`} value={values.systemPrompt} onChange={(e) => update("systemPrompt", e.target.value)} maxLength={8000} />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>{t.machineAgent.fieldInputSchema}</span>
              <textarea className={`${inputCls} min-h-[60px] font-mono text-xs`} value={values.inputSchemaJson} onChange={(e) => update("inputSchemaJson", e.target.value)} />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>{t.machineAgent.fieldOutputSchema}</span>
              <textarea className={`${inputCls} min-h-[60px] font-mono text-xs`} value={values.outputSchemaJson} onChange={(e) => update("outputSchemaJson", e.target.value)} />
            </label>
            <label className="block">
              <span className={labelCls}>{t.machineAgent.fieldMaxTokens}</span>
              <input className={inputCls} type="number" min={1} max={32000} value={values.maxTokens} onChange={(e) => update("maxTokens", Number(e.target.value))} />
            </label>
            <label className="block">
              <span className={labelCls}>{t.machineAgent.fieldTemperature}</span>
              <input className={inputCls} type="number" step={0.1} min={0} max={2} value={values.temperature} onChange={(e) => update("temperature", Number(e.target.value))} />
            </label>
            <label className="block">
              <span className={labelCls}>{t.machineAgent.fieldRateLimit}</span>
              <input className={inputCls} type="number" min={1} max={600} value={values.rateLimitPerMin} onChange={(e) => update("rateLimitPerMin", Number(e.target.value))} />
            </label>
          </div>
        </fieldset>

        {err ? <p className="text-sm text-rose-300">{err}</p> : null}

        <div className="flex flex-wrap gap-3 pt-2 border-t border-outline-variant/30">
          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] px-6 py-2 bg-primary/10 border border-primary/40 text-primary font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-primary/20 disabled:opacity-40 transition-colors"
          >
            {busy ? t.machineAgent.saving : t.machineAgent.save}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-6 py-2 border border-outline-variant text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-surface-container transition-colors"
          >
            {t.machineAgent.cancel}
          </button>
          {mode === "edit" && initial ? (
            <button
              type="button"
              onClick={onDelete}
              className="min-h-[44px] ml-auto px-6 py-2 border border-rose-400/40 text-rose-300 font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-rose-400/10 transition-colors"
            >
              {t.machineAgent.remove}
            </button>
          ) : null}
        </div>
      </form>
    </div>,
    portal,
  );
}
