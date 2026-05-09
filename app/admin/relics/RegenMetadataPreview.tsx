"use client";

// "🔄 重新生成名号 / 副标 / 图标" affordance for RelicForm.
//
// Calls POST /api/relics/[id]/regen-metadata with the optional admin
// feedback. Returns a metadata preview card the admin can apply (replaces
// the form fields) or discard. Does NOT directly persist — caller's
// onApply hook should update RelicForm state.

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

export type RegenResult = {
  titleZh: string;
  titleEn: string;
  subtitleZh: string;
  subtitleEn: string;
  icon: string;
  rarity: string;
  formKind?: string | null;
};

type Props = {
  relicId: string;
  onApply: (next: RegenResult) => void;
  disabled?: boolean;
};

export default function RegenMetadataPreview({ relicId, onApply, disabled }: Props) {
  const t = useT();
  const [feedback, setFeedback] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RegenResult | null>(null);

  async function trigger() {
    setRunning(true);
    setError(null);
    try {
      const r = await fetch(`/api/relics/${relicId}/regen-metadata`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: feedback.trim() || undefined }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${r.status}`);
        setRunning(false);
        return;
      }
      const j = (await r.json()) as RegenResult;
      setPreview(j);
      setRunning(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
      setRunning(false);
    }
  }

  return (
    <div className="border border-secondary/30 bg-secondary/[0.04] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
          {t.adminRelics.regenTitle}
        </span>
        <button
          type="button"
          onClick={trigger}
          disabled={disabled || running}
          className="px-3 py-1 border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10 disabled:opacity-40"
        >
          {running ? t.adminRelics.regenRunning : `🔄 ${t.adminRelics.regenButton}`}
        </button>
      </div>
      <input
        type="text"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={t.adminRelics.regenFeedbackPlaceholder}
        disabled={disabled || running}
        className="w-full bg-background/60 border border-secondary/20 px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:border-secondary/60"
        maxLength={300}
      />
      {error ? (
        <div className="text-[11px] text-error border border-error/30 bg-error/10 px-2 py-1">
          {error}
        </div>
      ) : null}
      {preview ? (
        <div className="space-y-1.5 border-t border-secondary/20 pt-2">
          <PreviewRow label={t.adminRelics.fieldTitleZh} value={preview.titleZh} />
          <PreviewRow label={t.adminRelics.fieldTitleEn} value={preview.titleEn} />
          <PreviewRow label={t.adminRelics.fieldSubtitleZh} value={preview.subtitleZh} />
          <PreviewRow label={t.adminRelics.fieldSubtitleEn} value={preview.subtitleEn} />
          <PreviewRow label={t.adminRelics.fieldIcon} value={preview.icon} />
          <PreviewRow label={t.adminRelics.fieldRarity} value={preview.rarity} />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="px-3 py-1 border border-on-surface-variant/40 text-on-surface-variant font-label text-[10px] tracking-[0.25em] uppercase hover:text-on-surface"
            >
              {t.adminRelics.regenDiscard}
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(preview);
                setPreview(null);
              }}
              className="px-3 py-1 bg-secondary text-background font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/90"
            >
              {t.adminRelics.regenApply}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-label text-[9px] tracking-[0.25em] uppercase text-on-surface-variant/70 shrink-0 w-20">
        {label}
      </span>
      <span className="text-[12px] text-on-surface truncate">{value}</span>
    </div>
  );
}
