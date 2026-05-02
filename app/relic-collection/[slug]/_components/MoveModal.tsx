"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

const TOTAL_SLOTS = 60;

type Props = {
  relicId: string;
  currentSlot: number;
  onClose: () => void;
  onMoved: () => void;
};

export default function MoveModal({ relicId, currentSlot, onClose, onMoved }: Props) {
  const t = useT();
  const [target, setTarget] = useState<number | null>(null);
  const [occupied, setOccupied] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/relics")
      .then((r) => r.json())
      .then((d) => {
        const used = new Set<number>(
          (d.relics ?? []).map((r: { slot: number }) => r.slot),
        );
        setOccupied(used);
      })
      .catch(() => undefined);
  }, []);

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
    if (!target || pending) return;
    if (target !== currentSlot && occupied.has(target)) {
      setError(format(t.adminRelics.moveSlotInUse, { slot: target }));
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/relics/${relicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: target }),
      });
      if (res.ok) {
        onMoved();
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
          {t.adminRelics.moveTitle}
        </h3>
        <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
          {t.adminRelics.moveTo}
        </p>
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: TOTAL_SLOTS }, (_, i) => i + 1).map((s) => {
            const isCur = s === currentSlot;
            const isUsed = occupied.has(s) && !isCur;
            const isTarget = s === target;
            return (
              <button
                key={s}
                type="button"
                disabled={isUsed}
                onClick={() => setTarget(s)}
                className={
                  "aspect-square border text-[11px] font-label tracking-wider transition-all " +
                  (isCur
                    ? "border-secondary/60 bg-secondary/15 text-secondary"
                    : isUsed
                      ? "border-error/20 text-error/30 cursor-not-allowed"
                      : isTarget
                        ? "border-primary bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(82,253,207,0.3)]"
                        : "border-primary/20 text-on-surface-variant hover:border-primary/60 hover:text-primary")
                }
              >
                {String(s).padStart(2, "0")}
              </button>
            );
          })}
        </div>
        {error ? (
          <p role="alert" className="font-label text-[11px] tracking-[0.2em] uppercase text-error">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
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
            disabled={!target || pending}
            className="px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
          >
            {pending ? t.adminRelics.saving : t.adminRelics.move}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
