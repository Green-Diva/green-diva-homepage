"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/types";

type Props = {
  relicId: string;
  reason: "locked-level" | "locked-password";
  required?: number;
  t: Dictionary;
  onClose: () => void;
};

export default function UnlockModal({ relicId, reason, required, t, onClose }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/relics/${relicId}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onClose();
        router.refresh();
        return;
      }
      const status = res.status;
      setError(status === 429 ? t.relicCollection.rateLimited : t.relicCollection.unlockFailed);
      setShake(true);
      setTimeout(() => setShake(false), 480);
    } catch {
      setError(t.relicCollection.unlockFailed);
    } finally {
      setPending(false);
    }
  }

  const isLevel = reason === "locked-level";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div
        className={
          "relative w-full max-w-md border border-primary/40 bg-background/95 p-6 shadow-[0_0_40px_rgba(82,253,207,0.15)] " +
          (shake ? "animate-[shake_0.42s_cubic-bezier(.36,.07,.19,.97)]" : "")
        }
      >
        <span className="absolute -top-px -left-px w-3 h-3 border-l border-t border-primary" />
        <span className="absolute -top-px -right-px w-3 h-3 border-r border-t border-primary" />
        <span className="absolute -bottom-px -left-px w-3 h-3 border-l border-b border-primary" />
        <span className="absolute -bottom-px -right-px w-3 h-3 border-r border-b border-primary" />

        <h3 className="font-headline text-lg text-primary tracking-wide uppercase mb-2">
          {isLevel ? t.relicCollection.needLevelTitle : t.relicCollection.needPasswordTitle}
        </h3>
        <p className="font-body text-on-surface-variant text-[13px] leading-[1.7] mb-5">
          {isLevel
            ? format(t.relicCollection.needLevelBody, { required: required ?? 0 })
            : t.relicCollection.needPasswordBody}
        </p>

        {!isLevel ? (
          <form onSubmit={submit} className="space-y-4">
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.relicCollection.passwordPlaceholder}
              className="w-full bg-transparent border-b border-primary/40 focus:border-primary outline-none px-1 py-2 text-on-surface text-[14px] tracking-wider placeholder:text-secondary/40 placeholder:text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            {error ? (
              <p
                role="alert"
                aria-live="polite"
                className="font-label text-[11px] text-error tracking-[0.2em] uppercase"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface"
              >
                {t.relicCollection.cancel}
              </button>
              <button
                type="submit"
                disabled={pending || !password}
                className="px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed font-label text-[11px] tracking-[0.2em] uppercase text-primary transition-all"
              >
                {pending ? t.relicCollection.unlocking : t.relicCollection.unlock}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
            >
              {t.relicCollection.cancel}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
