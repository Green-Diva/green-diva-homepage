"use client";

// Visible only when relic.status === "AWAITING_REVIEW" AND viewer is admin.
// Two CTAs: "编修存入" opens RelicForm prefilled with the AI output (admin
// edits then saves; banner chains a /confirm call after a successful save).
// "直接存入" skips the editor and just hits /confirm.
//
// AWAITING_REVIEW is a one-shot state — once flipped to READY it never
// returns. Subsequent edits go through the regular AdminToolbar / edit flow.

import { useState } from "react";
import { useRouter } from "next/navigation";
import RelicForm, { type RelicEditValue } from "@/app/admin/relics/RelicForm";
import { useT } from "@/lib/i18n/client";

type Props = {
  relic: RelicEditValue;
};

export default function AwaitingReviewBanner({ relic }: Props) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function callConfirm(): Promise<boolean> {
    try {
      const r = await fetch(`/api/relics/${relic.id}/confirm`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(typeof j.error === "string" ? j.error : t.relicCollection.reviewBannerError);
        return false;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t.relicCollection.reviewBannerError);
      return false;
    }
  }

  async function onDirectStore() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await callConfirm();
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <>
      <div className="mb-6 border border-secondary/50 bg-secondary/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span
            className="material-symbols-outlined text-secondary text-[20px] shrink-0"
            style={{ fontVariationSettings: "'FILL' 1" }}
            aria-hidden
          >
            pending
          </span>
          <div className="min-w-0">
            <p className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
              {t.relicCollection.reviewBannerTitle}
            </p>
            <p className="font-body text-[12px] text-on-surface-variant mt-1">
              {t.relicCollection.reviewBannerSubtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            className="px-4 py-1.5 border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10 disabled:opacity-40"
          >
            {t.relicCollection.reviewBannerEdit}
          </button>
          <button
            type="button"
            onClick={onDirectStore}
            disabled={busy}
            className="px-4 py-1.5 bg-secondary text-background font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/90 disabled:opacity-40"
          >
            {busy ? t.relicCollection.reviewBannerStoring : t.relicCollection.reviewBannerStore}
          </button>
        </div>
      </div>
      {error ? (
        <div className="mb-4 px-4 py-2 border border-error/40 bg-error/10 text-error text-[12px]">
          {error}
        </div>
      ) : null}

      {editing ? (
        <RelicForm
          initial={relic}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            // Save succeeded; chain confirm so the same click flips status.
            // If confirm fails the relic is left in a SAVED-but-still-pending
            // state — admin can hit "直接存入" to retry, no data lost.
            const ok = await callConfirm();
            setEditing(false);
            if (ok) router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
