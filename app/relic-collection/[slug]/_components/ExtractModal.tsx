"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type User = { id: string; name: string; level: number };

type Props = {
  relicId: string;
  relicName: string;
  onClose: () => void;
  onExtracted: () => void;
};

export default function ExtractModal({ relicId, relicName, onClose, onExtracted }: Props) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [target, setTarget] = useState<User | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/users/search`).then((r) => r.json()).then(setResults).catch(() => undefined);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then(setResults)
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

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
      const res = await fetch(`/api/relics/${relicId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: target?.id ?? null,
          notes: notes.trim() || null,
        }),
      });
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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto border border-error/40 bg-background/95 p-6 space-y-4">
        <div>
          <h3 className="font-headline text-lg text-error tracking-wide uppercase">
            {t.adminRelics.extract}
          </h3>
          <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mt-1">
            {format(t.adminRelics.extractConfirm, { name: relicName })}
          </p>
        </div>

        <div>
          <label className="block font-label text-[10px] tracking-[0.25em] uppercase text-secondary mb-1">
            {t.adminRelics.extractGivenTo}
          </label>
          <p className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant/60 mb-2">
            {t.adminRelics.extractGivenToHint}
          </p>
          {target ? (
            <div className="flex items-center justify-between border border-secondary/40 px-3 py-2">
              <span className="text-on-surface text-[13px]">{target.name}</span>
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="font-label text-[10px] tracking-[0.2em] uppercase text-error hover:underline"
              >
                ×
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t.adminRelics.shareSearch + " · " + t.adminRelics.extractKeepBlank}
                className="w-full bg-transparent border-b border-primary/40 focus:border-primary outline-none px-1 py-2 text-on-surface text-[13px]"
              />
              <ul className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {results.slice(0, 8).map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => setTarget(u)}
                      className="w-full text-left px-3 py-1.5 border border-primary/10 hover:border-primary/40 text-[12px] text-on-surface"
                    >
                      {u.name}
                      <span className="font-label text-[10px] tracking-[0.2em] text-on-surface-variant ml-2">
                        L{u.level}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <label className="block font-label text-[10px] tracking-[0.25em] uppercase text-secondary mb-1">
            {t.adminRelics.extractNotes}
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            placeholder={t.adminRelics.extractNotesHint}
            className="w-full bg-transparent border border-primary/20 focus:border-primary/60 outline-none px-2 py-1.5 text-on-surface text-[13px]"
          />
        </div>

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
            className="px-5 py-2 border border-error/60 bg-error/10 hover:bg-error/20 disabled:opacity-40 font-label text-[11px] tracking-[0.2em] uppercase text-error"
          >
            {pending ? t.adminRelics.saving : t.adminRelics.extract}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
