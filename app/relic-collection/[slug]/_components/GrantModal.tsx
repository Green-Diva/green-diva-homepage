"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type User = { id: string; name: string; level: number; serial: number | null };
type Grant = {
  id: string;
  createdAt: string;
  user: { id: string; name: string; level: number; avatarUrl: string | null };
  grantedBy: { id: string; name: string };
};

type Props = {
  relicId: string;
  relicName: string;
  onClose: () => void;
  onFinish?: () => void;
};

export default function GrantModal({ relicId, relicName, onClose, onFinish }: Props) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [pendingAdds, setPendingAdds] = useState<Map<string, string>>(new Map());
  const [pendingRemoves, setPendingRemoves] = useState<Map<string, string>>(new Map());
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    { kind: "grant" | "revoke"; userId: string; userName: string } | null
  >(null);

  useEffect(() => {
    fetch(`/api/admin/relics/${relicId}/grant`)
      .then((r) => (r.ok ? r.json() : { grants: [] }))
      .then((j) => setGrants(j.grants ?? []))
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

  const initialGrantedSet = useMemo(() => new Set(grants.map((g) => g.user.id)), [grants]);

  if (typeof document === "undefined") return null;

  function queueConfirm() {
    if (!confirmAction) return;
    const { kind, userId, userName } = confirmAction;
    if (kind === "grant") {
      // Restoring an initial-granted user that was queued for removal: undo the remove
      if (pendingRemoves.has(userId)) {
        const next = new Map(pendingRemoves);
        next.delete(userId);
        setPendingRemoves(next);
      } else {
        const next = new Map(pendingAdds);
        next.set(userId, userName);
        setPendingAdds(next);
      }
    } else {
      // Cancelling a pending add: just remove from adds
      if (pendingAdds.has(userId)) {
        const next = new Map(pendingAdds);
        next.delete(userId);
        setPendingAdds(next);
      } else {
        const next = new Map(pendingRemoves);
        next.set(userId, userName);
        setPendingRemoves(next);
      }
    }
    setConfirmAction(null);
  }

  async function commitBatch() {
    if (committing) return;
    if (pendingAdds.size === 0 && pendingRemoves.size === 0) {
      onFinish?.();
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      for (const userId of pendingRemoves.keys()) {
        const r = await fetch(
          `/api/admin/relics/${relicId}/grant?userId=${encodeURIComponent(userId)}`,
          { method: "DELETE" },
        );
        if (!r.ok) throw new Error("revoke failed");
      }
      for (const userId of pendingAdds.keys()) {
        const r = await fetch(`/api/admin/relics/${relicId}/grant`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!r.ok) throw new Error("grant failed");
      }
      onFinish?.();
    } catch {
      setError(t.adminRelics.commitFailed);
      setCommitting(false);
    }
  }

  const hasPending = pendingAdds.size > 0 || pendingRemoves.size > 0;

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
        {confirmAction ? (
          <>
            <h3 className="font-headline text-lg text-primary tracking-wide uppercase">
              {confirmAction.kind === "grant" ? t.adminRelics.grant : t.adminRelics.grantRevoke}
            </h3>
            <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant leading-relaxed">
              {format(
                confirmAction.kind === "grant"
                  ? t.adminRelics.grantConfirm
                  : t.adminRelics.grantRevokeConfirm,
                { user: confirmAction.userName },
              )}
            </p>
            <div className="flex justify-end gap-3 pt-2 border-t border-primary/10">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface"
              >
                {t.adminRelics.cancel}
              </button>
              <button
                type="button"
                onClick={queueConfirm}
                className={
                  "px-5 py-2 border font-label text-[11px] tracking-[0.2em] uppercase " +
                  (confirmAction.kind === "revoke"
                    ? "border-error/60 bg-error/10 hover:bg-error/20 text-error"
                    : "border-primary/60 bg-primary/10 hover:bg-primary/20 text-primary")
                }
              >
                {confirmAction.kind === "grant" ? t.adminRelics.grant : t.adminRelics.grantRevoke}
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h3 className="font-headline text-lg text-primary tracking-wide uppercase">
                {t.adminRelics.grantTitle}
              </h3>
              <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mt-1">
                {relicName}
              </p>
              <p className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant/70 mt-2 leading-relaxed">
                {t.adminRelics.grantHint}
              </p>
            </div>

            {grants.length > 0 || pendingAdds.size > 0 ? (
              <div>
                <h4 className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary mb-2">
                  {t.adminRelics.shareCurrent}
                </h4>
                <ul className="space-y-1">
                  {grants.map((g) => {
                    const queuedRemove = pendingRemoves.has(g.user.id);
                    return (
                      <li
                        key={g.id}
                        className={
                          "flex items-center justify-between gap-2 px-3 py-2 border text-[13px] " +
                          (queuedRemove ? "border-error/30 bg-error/5" : "border-primary/15")
                        }
                      >
                        <span className={"text-on-surface " + (queuedRemove ? "line-through opacity-60" : "")}>
                          {g.user.name}{" "}
                          <span className="font-label text-[10px] tracking-[0.2em] text-on-surface-variant ml-1">
                            {format(t.adminRelics.shareLevel, { level: g.user.level })}
                          </span>
                          {queuedRemove ? (
                            <span className="ml-2 px-1.5 py-0.5 border border-error/40 font-label text-[9px] tracking-[0.2em] uppercase text-error no-underline">
                              {t.adminRelics.pendingRevoke}
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            queuedRemove
                              ? setPendingRemoves((prev) => {
                                  const n = new Map(prev);
                                  n.delete(g.user.id);
                                  return n;
                                })
                              : setConfirmAction({
                                  kind: "revoke",
                                  userId: g.user.id,
                                  userName: g.user.name,
                                })
                          }
                          className="font-label text-[10px] tracking-[0.2em] uppercase text-error hover:underline"
                        >
                          {queuedRemove ? t.adminRelics.undoQueued : t.adminRelics.grantRevoke}
                        </button>
                      </li>
                    );
                  })}
                  {Array.from(pendingAdds.entries()).map(([userId, userName]) => (
                    <li
                      key={`add-${userId}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 border border-primary/40 bg-primary/5 text-[13px]"
                    >
                      <span className="text-on-surface">
                        {userName}
                        <span className="ml-2 px-1.5 py-0.5 border border-primary/40 font-label text-[9px] tracking-[0.2em] uppercase text-primary">
                          {t.adminRelics.pendingGrant}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAdds((prev) => {
                            const n = new Map(prev);
                            n.delete(userId);
                            return n;
                          })
                        }
                        className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface"
                      >
                        {t.adminRelics.undoQueued}
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
                    const isInitiallyGranted = initialGrantedSet.has(u.id);
                    const isQueuedAdd = pendingAdds.has(u.id);
                    const isQueuedRemove = pendingRemoves.has(u.id);
                    // Effectively granted = (initial AND not queued for remove) OR queued add
                    const effective = (isInitiallyGranted && !isQueuedRemove) || isQueuedAdd;
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
                          disabled={effective}
                          onClick={() =>
                            setConfirmAction({ kind: "grant", userId: u.id, userName: u.name })
                          }
                          className="px-3 py-1 border border-primary/40 hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed font-label text-[10px] tracking-[0.2em] uppercase text-primary"
                        >
                          {effective ? "✓" : t.adminRelics.grant}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
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
                disabled={committing}
                className="px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface disabled:opacity-40"
              >
                {t.adminRelics.cancel}
              </button>
              <button
                type="button"
                onClick={commitBatch}
                disabled={committing}
                className={
                  "px-5 py-2 border font-label text-[11px] tracking-[0.2em] uppercase disabled:opacity-40 " +
                  (hasPending
                    ? "border-secondary/60 bg-secondary/10 hover:bg-secondary/20 text-secondary"
                    : "border-primary/60 bg-primary/10 hover:bg-primary/20 text-primary")
                }
              >
                {committing ? t.adminRelics.saving : t.adminRelics.finish}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
