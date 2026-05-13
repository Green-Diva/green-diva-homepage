"use client";

// §2 命名与分类 — naming + classification block shared between
// DraftPreviewBody (review modal) and RelicForm (admin edit modal).
// Owns: nameEn/Zh, classifEn/Zh, rarity, iconKey.

import type { Dictionary } from "@/lib/i18n/types";

const RARITIES = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;
type Rarity = (typeof RARITIES)[number];

export type MetaFieldsValue = {
  nameEn: string;
  nameZh: string;
  classifEn: string;
  classifZh: string;
  rarity: Rarity;
  iconKey: string;
};

const inputClass =
  "w-full bg-transparent border border-primary/20 focus:border-primary/60 outline-none px-2 py-1.5 text-on-surface text-[13px]";

export default function MetaFields({
  value,
  onChange,
  disabled,
  required,
  t,
}: {
  value: MetaFieldsValue;
  onChange: (next: MetaFieldsValue) => void;
  disabled?: boolean;
  required?: boolean;
  t: Dictionary;
}) {
  function set<K extends keyof MetaFieldsValue>(k: K, v: MetaFieldsValue[K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label={t.adminRelics.fNameEn}>
        <input
          type="text"
          required={required}
          value={value.nameEn}
          onChange={(e) => set("nameEn", e.target.value)}
          disabled={disabled}
          className={inputClass}
        />
      </Field>
      <Field label={t.adminRelics.fNameZh}>
        <input
          type="text"
          required={required}
          value={value.nameZh}
          onChange={(e) => set("nameZh", e.target.value)}
          disabled={disabled}
          className={inputClass}
        />
      </Field>
      <Field label={t.adminRelics.fClassifEn}>
        <input
          type="text"
          required={required}
          value={value.classifEn}
          onChange={(e) => set("classifEn", e.target.value)}
          disabled={disabled}
          className={inputClass}
        />
      </Field>
      <Field label={t.adminRelics.fClassifZh}>
        <input
          type="text"
          required={required}
          value={value.classifZh}
          onChange={(e) => set("classifZh", e.target.value)}
          disabled={disabled}
          className={inputClass}
        />
      </Field>
      <Field label={t.adminRelics.fRarity}>
        <select
          value={value.rarity}
          onChange={(e) => set("rarity", e.target.value as Rarity)}
          disabled={disabled}
          className={inputClass}
        >
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.adminRelics.fIcon}>
        <div className="relative">
          <input
            type="text"
            value={value.iconKey}
            onChange={(e) => set("iconKey", e.target.value)}
            disabled={disabled}
            placeholder="inventory_2"
            className={inputClass + " pr-9"}
          />
          <span
            className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary text-[20px] pointer-events-none"
            style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}
          >
            {value.iconKey || "inventory_2"}
          </span>
        </div>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
