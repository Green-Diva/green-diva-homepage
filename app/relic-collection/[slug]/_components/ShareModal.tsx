"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type User = { id: string; name: string; level: number; serial: number | null };
type Share = {
  id: string;
  userId: string;
  createdAt: string;
  user: { name: string; level: number; serial: number | null };
};

type Props = {
  relicId: string;
  relicName: string;
  onClose: () => void;
};

export default function ShareModal({ relicId, relicName, onClose }: Props) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  async function loadShares() {
    const r = await fetch(`/api/admin/relics/${relicId}/share`);
    if (r.ok) setShares(await r.json());
  }

  useEffect(() => {
    fetch(`/api/admin/relics/${relicId}/share`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setShares)
      .catch(() => undefined);
    fetch(`/api/admin/users/search`)
      .then((r) => r.json())
      .then(setResults)
      .catch(() => undefined);
  }, [relicId]);

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

  async function grant(userId: string) {
    if (pending) return;
    setPending(userId);
    try {
      const res = await fetch(`/api/admin/relics/${relicId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) await loadShares();
    } finally {
      setPending(null);
    }
  }

  async function revoke(userId: string) {
    if (pending) return;
    setPending(userId);
    try {
      const res = await fetch(
        `/api/admin/relics/${relicId}/share?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      if (res.ok) await loadShares();
    } finally {
      setPending(null);
    }
  }

  const sharedSet = new Set(shares.map((s) => s.userId));

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto border border-primary/40 bg-background/95 p-6 space-y-4">
        <div>
          <h3 className="font-headline text-lg text-primary tracking-wide uppercase">
            {t.adminRelics.shareTitle}
          </h3>
          <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mt-1">
            {relicName}
          </p>
        </div>

        {shares.length > 0 ? (
          <div>
            <h4 className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary mb-2">
              {t.adminRelics.shareCurrent}
            </h4>
            <ul className="space-y-1">
              {shares.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 border border-primary/15 text-[13px]"
                >
                  <span className="text-on-surface">
                    {s.user.name}{" "}
                    <span className="font-label text-[10px] tracking-[0.2em] text-on-surface-variant ml-1">
                      {format(t.adminRelics.shareLevel, { level: s.user.level })}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => revoke(s.userId)}
                    disabled={pending === s.userId}
                    className="font-label text-[10px] tracking-[0.2em] uppercase text-error hover:underline disabled:opacity-40"
                  >
                    {t.adminRelics.shareRevoke}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.adminRelics.shareSearch}
            className="w-full bg-transparent border-b border-primary/40 focus:border-primary outline-none px-1 py-2 text-on-surface text-[14px]"
            autoFocus
          />
          <ul className="mt-3 space-y-1 max-h-72 overflow-y-auto">
            {results.length === 0 ? (
              <li className="px-3 py-3 font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant/60">
                {t.adminRelics.shareEmpty}
              </li>
            ) : (
              results.map((u) => {
                const already = sharedSet.has(u.id);
                return (
                  <li
                    key={u.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 border border-primary/10 hover:border-primary/30 text-[13px]"
                  >
                    <span className="text-on-surface">
                      {u.name}{" "}
                      <span className="font-label text-[10px] tracking-[0.2em] text-on-surface-variant ml-1">
                        {format(t.adminRelics.shareLevel, { level: u.level })}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={already || pending === u.id}
                      onClick={() => grant(u.id)}
                      className="px-3 py-1 border border-primary/40 hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed font-label text-[10px] tracking-[0.2em] uppercase text-primary"
                    >
                      {already ? "✓" : t.adminRelics.shareGrant}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="flex justify-end pt-2 border-t border-primary/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface"
          >
            {t.adminRelics.cancel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
