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
  fillHeight = false,
  t,
}: {
  loreEn: string;
  loreZh: string;
  onChange: (next: { loreEn: string; loreZh: string }) => void;
  disabled?: boolean;
  rows?: number;
  /** When true, both textareas stretch to fill the parent's height. */
  fillHeight?: boolean;
  t: Dictionary;
}) {
  const wrapperCls = fillHeight ? "grid grid-cols-2 gap-3 h-full" : "grid grid-cols-2 gap-3";
  const labelCls = fillHeight ? "flex flex-col min-h-0" : "block";
  const taExtra = fillHeight ? " flex-1 min-h-0 resize-none" : " resize-y";
  return (
    <div className={wrapperCls}>
      <label className={labelCls}>
        <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
          {t.adminRelics.fLoreEn}
        </span>
        <textarea
          rows={fillHeight ? undefined : rows}
          value={loreEn}
          onChange={(e) => onChange({ loreEn: e.target.value, loreZh })}
          disabled={disabled}
          className={inputClass + " leading-relaxed" + taExtra}
        />
      </label>
      <label className={labelCls}>
        <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
          {t.adminRelics.fLoreZh}
        </span>
        <textarea
          rows={fillHeight ? undefined : rows}
          value={loreZh}
          onChange={(e) => onChange({ loreEn, loreZh: e.target.value })}
          disabled={disabled}
          className={inputClass + " leading-relaxed" + taExtra}
        />
      </label>
    </div>
  );
}
