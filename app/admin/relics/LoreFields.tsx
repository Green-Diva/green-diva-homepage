"use client";

// §4 圣记 — bilingual Markdown lore textareas shared between
// DraftPreviewBody and RelicForm.

import type { Dictionary } from "@/lib/i18n/types";

const inputClass =
  "w-full bg-transparent border border-primary/20 focus:border-primary/60 outline-none px-2 py-1.5 text-on-surface text-[13px]";

export default function LoreFields({
  loreEn,
  loreZh,
  onChange,
  disabled,
  rows = 4,
  t,
}: {
  loreEn: string;
  loreZh: string;
  onChange: (next: { loreEn: string; loreZh: string }) => void;
  disabled?: boolean;
  rows?: number;
  t: Dictionary;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
          {t.adminRelics.fLoreEn}
        </span>
        <textarea
          rows={rows}
          value={loreEn}
          onChange={(e) => onChange({ loreEn: e.target.value, loreZh })}
          disabled={disabled}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
          {t.adminRelics.fLoreZh}
        </span>
        <textarea
          rows={rows}
          value={loreZh}
          onChange={(e) => onChange({ loreEn, loreZh: e.target.value })}
          disabled={disabled}
          className={inputClass}
        />
      </label>
    </div>
  );
}
