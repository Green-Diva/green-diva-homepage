"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { SkillRow } from "../types";
import type { AgentSkillKind } from "@/lib/agentTypes";

type Props = {
  mode: "create" | "edit";
  initial?: SkillRow | null;
  onClose: () => void;
  onSaved: () => void;
};

const KIND_OPTIONS: AgentSkillKind[] = ["PASSIVE", "ACTIVE", "ULTIMATE"];
const LEVEL_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

function blank(initial?: SkillRow | null) {
  return {
    level: String(initial?.level ?? 1),
    icon: initial?.icon ?? "",
    nameEn: initial?.nameEn ?? "",
    nameZh: initial?.nameZh ?? "",
    kind: (initial?.kind ?? "PASSIVE") as AgentSkillKind,
    costAp: String(initial?.costAp ?? 0),
    descriptionEn: initial?.descriptionEn ?? "",
    descriptionZh: initial?.descriptionZh ?? "",
  };
}

export default function SkillEditor({ mode, initial, onClose, onSaved }: Props) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState(() => blank(initial));
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
  }, [onClose, busy]);

  const portal = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);
  if (!portal) return null;

  function upd<K extends keyof typeof v>(key: K, val: (typeof v)[K]) {
    setV((s) => ({ ...s, [key]: val }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = {
      level: Number(v.level),
      icon: v.icon.trim(),
      nameEn: v.nameEn.trim(),
      nameZh: v.nameZh.trim(),
      kind: v.kind,
      costAp: Number(v.costAp),
      descriptionEn: v.descriptionEn.trim(),
      descriptionZh: v.descriptionZh.trim(),
    };
    const url = mode === "create" ? "/api/skills" : `/api/skills/${initial?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : t.machineAgent.skillSaveFailed);
      return;
    }
    router.refresh();
    onSaved();
    onClose();
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(format(t.machineAgent.skillDeleteConfirm, { name: initial.nameZh || initial.nameEn }))) return;
    const r = await fetch(`/api/skills/${initial.id}`, { method: "DELETE" });
    if (!r.ok) {
      alert(t.machineAgent.skillDeleteFailed);
      return;
    }
    router.refresh();
    onSaved();
    onClose();
  }

  const inputCls =
    "w-full bg-surface-variant/30 border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary/60 focus:bg-surface-variant/50 transition-colors";
  const labelCls = "font-label text-[10px] tracking-[0.25em] text-primary/70 uppercase mb-1 block";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "create" ? t.machineAgent.skillCreateNew : t.machineAgent.skillEdit}
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/85 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg my-auto p-4 flex flex-col gap-0">
        <div className="cyber-panel rounded-lg p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">
              {mode === "create" ? t.machineAgent.skillCreateNew : t.machineAgent.skillEdit}
            </h2>
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

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Level</label>
                <select
                  value={v.level}
                  onChange={(e) => upd("level", e.target.value)}
                  className={inputCls}
                  required
                >
                  {LEVEL_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      LV.{n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Kind</label>
                <select
                  value={v.kind}
                  onChange={(e) => upd("kind", e.target.value as AgentSkillKind)}
                  className={inputCls}
                  required
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Icon (Material Symbol)</label>
                <input
                  type="text"
                  value={v.icon}
                  onChange={(e) => upd("icon", e.target.value)}
                  className={inputCls}
                  placeholder="psychology"
                  required
                />
              </div>
              <div>
                <label className={labelCls}>AP Cost</label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={v.costAp}
                  onChange={(e) => upd("costAp", e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Name EN</label>
              <input
                type="text"
                value={v.nameEn}
                onChange={(e) => upd("nameEn", e.target.value)}
                className={inputCls}
                required
              />
            </div>
            <div>
              <label className={labelCls}>Name ZH</label>
              <input
                type="text"
                value={v.nameZh}
                onChange={(e) => upd("nameZh", e.target.value)}
                className={inputCls}
                required
              />
            </div>
            <div>
              <label className={labelCls}>Description EN</label>
              <textarea
                rows={3}
                value={v.descriptionEn}
                onChange={(e) => upd("descriptionEn", e.target.value)}
                className={inputCls + " resize-none"}
              />
            </div>
            <div>
              <label className={labelCls}>Description ZH</label>
              <textarea
                rows={3}
                value={v.descriptionZh}
                onChange={(e) => upd("descriptionZh", e.target.value)}
                className={inputCls + " resize-none"}
              />
            </div>

            {err && <p className="text-error text-sm">{err}</p>}

            <div className="flex items-center justify-between gap-3 pt-1">
              {mode === "edit" ? (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busy}
                  className="font-label text-[10px] tracking-[0.2em] uppercase text-error/70 hover:text-error transition-colors min-h-[44px] px-3"
                >
                  {t.machineAgent.remove}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface transition-colors min-h-[44px] px-4"
                >
                  {t.machineAgent.cancel}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[44px] px-6"
                >
                  {busy ? t.machineAgent.saving : t.machineAgent.save}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>,
    portal,
  );
}
