"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type Props = {
  relicId: string;
  relicName: string;
  onClose: () => void;
  onExtracted: () => void;
};

export default function ExtractModal({ relicId, relicName, onClose, onExtracted }: Props) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  async function submit() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/relics/${relicId}/extract`, { method: "POST" });
      if (res.ok) {
        onExtracted();
      } else {
        setError(t.adminRelics.saveFailed);
      }
    } catch {
      setError(t.adminRelics.saveFailed);
    } finally {
      setPending(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md border border-primary/40 bg-background/95 p-6 space-y-4">
        <h3 className="font-headline text-lg text-primary tracking-wide uppercase">
          {t.adminRelics.extract}
        </h3>
        <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant leading-relaxed">
          {format(t.adminRelics.extractConfirm, { name: relicName })}
        </p>
        {error ? (
          <p role="alert" className="font-label text-[11px] tracking-[0.2em] uppercase text-error">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2 border-t border-primary/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface"
          >
            {t.adminRelics.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
          >
            {pending ? t.adminRelics.saving : t.adminRelics.extract}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
