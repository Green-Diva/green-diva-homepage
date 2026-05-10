"use client";

// Phase 4 import UI. Admin pastes the JSON exported by another deploy
// (or uploads a .json file), optionally overrides codename + chooses how
// to handle skill-slug collisions, and submits.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type Props = {
  onClose: () => void;
  onSaved: () => void;
};

type SkillConflict = "reuse" | "rename";

function tryParse(json: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = json.trim();
  if (!t) return { ok: false, error: "empty" };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid JSON" };
  }
}

export default function AgentImportModal({ onClose, onSaved }: Props) {
  const t = useT();
  const router = useRouter();
  const [json, setJson] = useState<string>("");
  const [newCodename, setNewCodename] = useState<string>("");
  const [skillConflict, setSkillConflict] = useState<SkillConflict>("reuse");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);

  const parsed = useMemo(() => tryParse(json), [json]);
  const jsonInvalid = !parsed.ok && json.trim().length > 0;

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setJson(text);
      setErr(null);
    } catch (readErr) {
      setErr(readErr instanceof Error ? readErr.message : "file read failed");
    }
  }

  async function onSubmit() {
    if (!parsed.ok) {
      setErr(t.agentControl.importInvalidJson);
      return;
    }
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/agents/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: parsed.value,
          newCodename: newCodename.trim() || undefined,
          skillConflict,
        }),
      });
      const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        const msg =
          typeof body.error === "string"
            ? body.error
            : `${t.agentControl.importFailed} (HTTP ${r.status})`;
        setErr(msg);
        return;
      }
      const codename = typeof body.codename === "string" ? body.codename : "?";
      setOkMsg(format(t.agentControl.importSuccess, { codename }));
      router.refresh();
      // Auto-close after a short success display.
      setTimeout(() => {
        onSaved();
        onClose();
      }, 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.agentControl.importFailed);
    } finally {
      setBusy(false);
    }
  }

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[1000] bg-background/85 backdrop-blur-md flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg border border-primary/30 bg-surface p-5 space-y-4 shadow-2xl">
        <header className="flex items-start justify-between gap-3 pb-3 border-b border-primary/15">
          <div>
            <div className="font-label text-[10px] tracking-[0.3em] uppercase text-primary mb-1">
              {t.agentControl.importAgentTitle}
            </div>
            <p className="text-xs text-on-surface-variant max-w-md">
              {t.agentControl.importAgentHint}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
            aria-label="close"
          >
            close
          </button>
        </header>

        {/* JSON paste */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-label text-[10px] tracking-[0.3em] uppercase text-primary">
              {t.agentControl.importPasteJson}
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="font-label text-[10px] tracking-[0.25em] uppercase text-secondary hover:text-secondary/80 transition-colors disabled:opacity-50"
            >
              {t.agentControl.importChooseFile}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onUpload}
            />
          </div>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            disabled={busy}
            rows={12}
            spellCheck={false}
            className={[
              "w-full bg-surface-variant border rounded px-3 py-2 font-mono text-xs text-on-surface focus:outline-none transition-colors",
              jsonInvalid
                ? "border-rose-500/50 focus:border-rose-500"
                : "border-primary/30 focus:border-primary",
            ].join(" ")}
            placeholder='{ "format": "green-diva-agent-export-v1", ... }'
          />
          {jsonInvalid ? (
            <p className="text-[11px] text-rose-400">{t.agentControl.importInvalidJson}</p>
          ) : null}
        </div>

        {/* Override codename */}
        <div>
          <label className="block font-label text-[10px] tracking-[0.3em] uppercase text-primary mb-1">
            {t.agentControl.importNewCodename}
          </label>
          <input
            type="text"
            value={newCodename}
            onChange={(e) => setNewCodename(e.target.value)}
            disabled={busy}
            placeholder="(optional)"
            className="w-full bg-surface-variant border border-primary/30 rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
          />
          <p className="text-[11px] text-on-surface-variant mt-1">
            {t.agentControl.importNewCodenameHint}
          </p>
        </div>

        {/* Skill conflict policy */}
        <div>
          <label className="block font-label text-[10px] tracking-[0.3em] uppercase text-primary mb-1">
            {t.agentControl.importSkillConflict}
          </label>
          <select
            value={skillConflict}
            onChange={(e) => setSkillConflict(e.target.value as SkillConflict)}
            disabled={busy}
            className="w-full bg-surface-variant border border-primary/30 rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
          >
            <option value="reuse">{t.agentControl.importSkillConflictReuse}</option>
            <option value="rename">{t.agentControl.importSkillConflictRename}</option>
          </select>
        </div>

        {/* Status / footer */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-primary/15">
          <div className="text-xs flex-1 min-h-[1em]">
            {err ? <span className="text-rose-400">{err}</span> : null}
            {okMsg ? <span className="text-emerald-300">{okMsg}</span> : null}
          </div>
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
            onClick={onSubmit}
            disabled={busy || !parsed.ok}
            className="min-h-[36px] px-5 rounded border border-primary/40 bg-primary/[0.08] hover:bg-primary/[0.16] text-primary font-label text-[10px] tracking-[0.3em] uppercase transition-colors disabled:opacity-50"
          >
            {busy ? t.agentControl.importing : t.agentControl.importSubmit}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
