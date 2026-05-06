"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { AgentRow, AgentStatus, AgentMode } from "../types";
import AvatarCropModal from "./AvatarCropModal";

type Mode = "create" | "edit";

type Props = {
  mode: Mode;
  initial: AgentRow | null;
  onClose: () => void;
  onSaved: () => void;
};

const STATUSES: AgentStatus[] = ["ONLINE", "STANDBY", "OFFLINE"];
const MODES: AgentMode[] = ["AUTONOMOUS", "MECHANICAL"];

type DropdownOption = { value: string; label: string };

function ThemedDropdown({
  value,
  options,
  onChange,
  isMech,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  isMech: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const accent = isMech ? "secondary" : "primary";
  const triggerCls = isMech
    ? "mt-1 h-10 w-full rounded-md border border-secondary/20 bg-surface-container pl-3.5 pr-9 text-sm text-on-surface text-left flex items-center hover:border-secondary/40 focus:border-secondary/60 focus:outline-none transition-colors"
    : "mt-1 h-10 w-full rounded-md border border-primary/20 bg-surface-container pl-3.5 pr-9 text-sm text-on-surface text-left flex items-center hover:border-primary/40 focus:border-primary/60 focus:outline-none transition-colors";
  const chevronCls = isMech
    ? "absolute right-3 top-[calc(50%+2px)] -translate-y-1/2 pointer-events-none material-symbols-outlined text-base text-secondary/60"
    : "absolute right-3 top-[calc(50%+2px)] -translate-y-1/2 pointer-events-none material-symbols-outlined text-base text-primary/60";
  const panelCls = isMech
    ? "absolute z-50 mt-1 w-full rounded-md border border-secondary/30 bg-surface-container shadow-lg shadow-black/40 overflow-hidden"
    : "absolute z-50 mt-1 w-full rounded-md border border-primary/30 bg-surface-container shadow-lg shadow-black/40 overflow-hidden";
  const itemBase = "block w-full text-left px-3.5 h-10 text-sm flex items-center gap-2 transition-colors";
  const itemActiveCls = isMech ? `${itemBase} bg-secondary/15 text-secondary` : `${itemBase} bg-primary/15 text-primary`;
  const itemHoverCls = isMech ? `${itemBase} text-on-surface hover:bg-secondary/10 hover:text-secondary` : `${itemBase} text-on-surface hover:bg-primary/10 hover:text-primary`;
  void accent;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={triggerCls}
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current?.label ?? value}
      </button>
      <span aria-hidden className={chevronCls}>{open ? "expand_less" : "expand_more"}</span>
      {open ? (
        <div className={panelCls} role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={o.value === value ? itemActiveCls : itemHoverCls}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.value === value ? (
                <span className="material-symbols-outlined text-base" aria-hidden>check</span>
              ) : (
                <span className="w-4" aria-hidden />
              )}
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function blankFromInitial(initial: AgentRow | null) {
  return {
    codename: initial?.codename ?? "",
    codenameZh: initial?.codenameZh ?? "",
    nameEn: initial?.nameEn ?? "",
    nameZh: initial?.nameZh ?? "",
    // New agents default to AUTONOMOUS (primary green theme); existing ones
    // keep whatever was on the row.
    mode: (initial?.mode ?? "AUTONOMOUS") as AgentMode,
    status: (initial?.status ?? "STANDBY") as AgentStatus,
    avatarUrl: initial?.avatarUrl ?? "",
    descriptionEn: initial?.descriptionEn ?? "",
    descriptionZh: initial?.descriptionZh ?? "",
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

  // Mode-driven accent: AUTONOMOUS = primary (green/cyan), MECHANICAL = secondary (gold).
  const isMech = values.mode === "MECHANICAL";
  const inputBase = isMech
    ? "mt-1 w-full rounded-md border border-secondary/20 bg-surface-container text-sm text-on-surface focus:border-secondary/60 focus:outline-none transition-colors"
    : "mt-1 w-full rounded-md border border-primary/20 bg-surface-container text-sm text-on-surface focus:border-primary/60 focus:outline-none transition-colors";
  const inputCls = `${inputBase} h-10 px-3.5`;
  const selectCls = `${inputCls} appearance-none pr-9 cursor-pointer`;
  const textareaCls = `${inputBase} min-h-[96px] px-3.5 py-2.5 leading-relaxed`;
  const labelCls = isMech
    ? "text-[11px] font-label uppercase tracking-[0.25em] text-secondary/70"
    : "text-[11px] font-label uppercase tracking-[0.25em] text-primary/60";
  const chevronCls = isMech
    ? "absolute right-3 top-[calc(50%+2px)] -translate-y-1/2 pointer-events-none material-symbols-outlined text-base text-secondary/60"
    : "absolute right-3 top-[calc(50%+2px)] -translate-y-1/2 pointer-events-none material-symbols-outlined text-base text-primary/60";
  const headingCls = isMech ? "text-secondary" : "text-primary";
  const dashedCls = values.avatarUrl
    ? (isMech ? "border-secondary/30 hover:border-secondary/60" : "border-primary/30 hover:border-primary/60")
    : (isMech ? "border-secondary/40 hover:border-secondary/70 bg-surface-container/50" : "border-primary/40 hover:border-primary/70 bg-surface-container/50");
  const submitCls = isMech
    ? "min-h-[44px] px-6 py-2 bg-secondary/10 border border-secondary/40 text-secondary font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-secondary/20 disabled:opacity-40 transition-colors"
    : "min-h-[44px] px-6 py-2 bg-primary/10 border border-primary/40 text-primary font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-primary/20 disabled:opacity-40 transition-colors";

  function update<K extends keyof typeof values>(key: K, v: (typeof values)[K]) {
    setValues((s) => ({ ...s, [key]: v }));
  }

  const [uploadBusy, setUploadBusy] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  function onAvatarPick(file: File) {
    setErr(null);
    // Read file → data URL → open crop modal. Upload happens after crop apply.
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setCropSrc(reader.result);
    };
    reader.onerror = () => setErr("could not read file");
    reader.readAsDataURL(file);
  }

  async function uploadCroppedBlob(blob: Blob) {
    setCropSrc(null);
    setUploadBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", new File([blob], `portrait-${Date.now()}.jpg`, { type: "image/jpeg" }));
      const r = await fetch("/api/agents/avatar/upload", { method: "POST", body: fd });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        let msg = `upload failed (${r.status})`;
        try {
          const j = JSON.parse(text);
          if (typeof j.error === "string") msg = j.error;
        } catch {
          if (text) msg = `upload failed (${r.status}): ${text.slice(0, 120)}`;
        }
        setErr(msg);
        return;
      }
      const j = (await r.json()) as { url?: string };
      if (j.url) update("avatarUrl", j.url);
    } catch (e) {
      setErr(`network error: ${(e as Error).message}`);
    } finally {
      setUploadBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    if (!values.avatarUrl.trim()) {
      setBusy(false);
      setErr(t.agentControl.avatarRequired);
      return;
    }

    const body: Record<string, unknown> = {
      codename: values.codename.trim(),
      codenameZh: values.codenameZh.trim() || null,
      nameEn: values.nameEn.trim(),
      nameZh: values.nameZh.trim(),
      mode: values.mode,
      status: values.status,
      avatarUrl: values.avatarUrl.trim(),
      descriptionEn: values.descriptionEn.trim() || null,
      descriptionZh: values.descriptionZh.trim() || null,
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
    if (!confirm(format(t.agentControl.confirmRemove, { name: initial.codename }))) return;
    const r = await fetch(`/api/agents/${initial.id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`${t.agentControl.deleteFailed}: ${j.error ?? r.statusText}`);
      return;
    }
    onSaved();
    onClose();
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "create" ? t.agentControl.editorNewTitle : t.agentControl.editorEditTitle}
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
          <h2 className={`font-headline text-3xl sacred-glow ${headingCls}`}>
            {mode === "create" ? t.agentControl.editorNewTitle : t.agentControl.editorEditTitle}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-on-surface-variant hover:text-primary"
            aria-label={t.agentControl.cancel}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-5">
          {/* Left: portrait upload — aspect 131:304 ≈ 0.4309 to match the outer
              hero portrait CyberPanel container (262×608) including its border + padding. */}
          <div className="sm:w-[200px] shrink-0">
            <span className={labelCls}>{t.agentControl.fieldAvatar} *</span>
            <label
              className={[
                "mt-1 relative block w-full aspect-[131/304] rounded-md overflow-hidden cursor-pointer group",
                "border border-dashed transition-colors",
                dashedCls,
              ].join(" ")}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onAvatarPick(f);
                  e.target.value = "";
                }}
              />
              {values.avatarUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={values.avatarUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <span className={`font-label text-[10px] tracking-[0.3em] uppercase ${headingCls}`}>
                      {uploadBusy ? "…" : "REPLACE"}
                    </span>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-3xl opacity-70" aria-hidden>
                    {uploadBusy ? "progress_activity" : "image"}
                  </span>
                  <span className={`font-label text-[9px] tracking-[0.3em] uppercase ${isMech ? "text-secondary/70" : "text-primary/70"}`}>
                    {uploadBusy ? "uploading…" : "click to upload"}
                  </span>
                  <span className="text-[9px] text-on-surface-variant/60 px-2 text-center">
                    JPG / PNG / WEBP · 5MB max
                  </span>
                </div>
              )}
            </label>
          </div>

          {/* Right: short fields */}
          <div className="flex-1 grid sm:grid-cols-2 gap-4">
            {/* Row 1: Mode | Status */}
            <div className="block">
              <span className={labelCls}>Mode</span>
              <ThemedDropdown
                value={values.mode}
                options={MODES.map((m) => ({
                  value: m,
                  label: m === "MECHANICAL" ? t.agentControl.modeMechanical : t.agentControl.modeAutonomous,
                }))}
                onChange={(v) => update("mode", v as AgentMode)}
                isMech={isMech}
              />
            </div>
            <div className="block">
              <span className={labelCls}>{t.agentControl.fieldStatus}</span>
              <ThemedDropdown
                value={values.status}
                options={STATUSES.map((s) => ({ value: s, label: s }))}
                onChange={(v) => update("status", v as AgentStatus)}
                isMech={isMech}
              />
            </div>

            {/* Row 2: Name (EN, slug-like codename) | Name (ZH, codenameZh) */}
            <label className="block">
              <span className={labelCls}>{t.agentControl.fieldCodename}</span>
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
              <span className={labelCls}>{t.agentControl.fieldCodenameZh}</span>
              <input
                className={inputCls}
                value={values.codenameZh}
                onChange={(e) => update("codenameZh", e.target.value)}
                maxLength={32}
              />
            </label>

            {/* Row 3: Role (EN, nameEn) | Role (ZH, nameZh) */}
            <label className="block">
              <span className={labelCls}>{t.agentControl.fieldNameEn}</span>
              <input className={inputCls} value={values.nameEn} onChange={(e) => update("nameEn", e.target.value)} required />
            </label>
            <label className="block">
              <span className={labelCls}>{t.agentControl.fieldNameZh}</span>
              <input className={inputCls} value={values.nameZh} onChange={(e) => update("nameZh", e.target.value)} required />
            </label>

            {/* Descriptions stack inside right column: EN on top, ZH below */}
            <label className="block sm:col-span-2">
              <span className={labelCls}>{t.agentControl.fieldDescriptionEn}</span>
              <textarea className={textareaCls} value={values.descriptionEn} onChange={(e) => update("descriptionEn", e.target.value)} maxLength={4000} />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>{t.agentControl.fieldDescriptionZh}</span>
              <textarea className={textareaCls} value={values.descriptionZh} onChange={(e) => update("descriptionZh", e.target.value)} maxLength={4000} />
            </label>

            {/* Form actions inside right column, right-aligned */}
            <div className="sm:col-span-2 flex flex-wrap gap-3 pt-2 border-t border-outline-variant/30 justify-end">
              {mode === "edit" && initial ? (
                <button
                  type="button"
                  onClick={onDelete}
                  className="min-h-[44px] mr-auto px-6 py-2 border border-rose-400/40 text-rose-300 font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-rose-400/10 transition-colors"
                >
                  {t.agentControl.remove}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-6 py-2 border border-outline-variant text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-surface-container transition-colors"
              >
                {t.agentControl.cancel}
              </button>
              <button
                type="submit"
                disabled={busy}
                className={submitCls}
              >
                {busy ? t.agentControl.saving : t.agentControl.save}
              </button>
            </div>
          </div>
        </div>

        {err ? <p className="text-sm text-rose-300">{err}</p> : null}
      </form>
      {cropSrc ? (
        <AvatarCropModal
          src={cropSrc}
          isMech={isMech}
          onCancel={() => setCropSrc(null)}
          onApply={(blob) => void uploadCroppedBlob(blob)}
        />
      ) : null}
    </div>,
    portal,
  );
}
