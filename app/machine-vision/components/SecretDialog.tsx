"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type Props = {
  name: string;
  onClose: () => void;
  onSaved: () => void;
};

export default function SecretDialog({ name, onClose, onSaved }: Props) {
  const t = useT();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, submitting]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!value.trim()) {
      setError(t.machineVision.secretEmptyValue);
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/admin/agent-secrets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value }),
      });
      if (!r.ok) {
        setSubmitting(false);
        setError(t.machineVision.secretSaveFailed);
        return;
      }
      onSaved();
    } catch (err) {
      console.error("[SecretDialog] save failed", err);
      setSubmitting(false);
      setError(t.machineVision.secretSaveFailed);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <form
        onSubmit={submit}
        className="relative w-full max-w-lg mt-16 mb-12 border border-primary/40 bg-surface-container/95 shadow-[0_0_42px_rgba(140,255,225,0.18)] p-6 sm:p-7 space-y-5"
      >
        <div>
          <h2 className="text-primary text-xl tracking-wider">
            {format(t.machineVision.secretDialogTitle, { name })}
          </h2>
          <p className="mt-2 text-[12px] text-on-surface-variant leading-relaxed">
            {t.machineVision.secretDialogHint}
          </p>
        </div>

        <div className="space-y-2">
          <label className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
            {name}
          </label>
          <input
            ref={inputRef}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
            placeholder={t.machineVision.secretDialogPlaceholder}
            className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary font-mono"
          />
        </div>

        {error ? (
          <p className="text-sm text-error border border-error/30 bg-error/10 px-3 py-2">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-3 pt-2 border-t border-primary/20">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant hover:text-on-surface disabled:opacity-40"
          >
            {t.machineVision.secretDialogCancel}
          </button>
          <button
            type="submit"
            disabled={submitting || !value.trim()}
            className="px-6 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90 disabled:bg-on-surface-variant/30 disabled:text-on-surface-variant disabled:cursor-not-allowed"
          >
            {submitting ? t.machineVision.secretDialogSaving : t.machineVision.secretDialogSave}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
