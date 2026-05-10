"use client";

// Pre-flight config dialog for Meshy image-to-3D. Opens when admin clicks
// "▷ 生成 3D 模型" in AssetCard's 3D row; the actual /create-3d POST is
// only fired after admin confirms here. Defaults are tuned for collectible-
// grade quality (PBR + HD texture + auto-size all on, standard polycount).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Dictionary } from "@/lib/i18n/types";

export type Meshy3dOptions = {
  enablePbr: boolean;
  hdTexture: boolean;
  autoSize: boolean;
  modelType: "standard" | "lowpoly";
  symmetryMode: "auto" | "on" | "off";
  // undefined = use Meshy default (~30k); explicit number 100..300_000 overrides.
  targetPolycount?: number;
  // ≤600 chars; trimmed before send.
  texturePrompt?: string;
};

const DEFAULTS: Meshy3dOptions = {
  enablePbr: true,
  hdTexture: true,
  autoSize: true,
  modelType: "standard",
  symmetryMode: "auto",
};

type Props = {
  onConfirm: (opts: Meshy3dOptions) => void;
  onCancel: () => void;
  t: Dictionary;
};

export default function Meshy3dConfigModal({ onConfirm, onCancel, t }: Props) {
  const [opts, setOpts] = useState<Meshy3dOptions>(DEFAULTS);
  const [polycountText, setPolycountText] = useState("");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  function handleConfirm() {
    const out: Meshy3dOptions = { ...opts };
    if (polycountText.trim()) {
      const n = Number(polycountText);
      if (Number.isFinite(n) && n >= 100 && n <= 300_000) {
        out.targetPolycount = Math.round(n);
      }
    }
    if (out.texturePrompt) {
      out.texturePrompt = out.texturePrompt.trim().slice(0, 600);
      if (!out.texturePrompt) delete out.texturePrompt;
    }
    onConfirm(out);
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      // Above the parent RelicForm modal (z=200), so this dialog stacks correctly.
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-lg mt-12 mb-12 border border-secondary/40 bg-surface-container/95 shadow-[0_0_42px_rgba(233,193,118,0.18)] p-6 space-y-5">
        <div>
          <h2 className="text-secondary text-xl tracking-wider">
            {t.relicCollection.meshy3dConfigTitle}
          </h2>
          <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/75 mt-1">
            {t.relicCollection.meshy3dConfigSubtitle}
          </p>
        </div>

        {/* Toggles */}
        <div className="space-y-3">
          <Toggle
            label={t.relicCollection.meshy3dEnablePbr}
            hint={t.relicCollection.meshy3dEnablePbrHint}
            checked={opts.enablePbr}
            onChange={(v) => setOpts((s) => ({ ...s, enablePbr: v }))}
          />
          <Toggle
            label={t.relicCollection.meshy3dHdTexture}
            hint={t.relicCollection.meshy3dHdTextureHint}
            checked={opts.hdTexture}
            onChange={(v) => setOpts((s) => ({ ...s, hdTexture: v }))}
          />
          <Toggle
            label={t.relicCollection.meshy3dAutoSize}
            hint={t.relicCollection.meshy3dAutoSizeHint}
            checked={opts.autoSize}
            onChange={(v) => setOpts((s) => ({ ...s, autoSize: v }))}
          />
        </div>

        {/* Selects */}
        <div className="grid grid-cols-2 gap-4">
          <Field label={t.relicCollection.meshy3dModelType}>
            <NativeSelect
              value={opts.modelType}
              onChange={(v) => setOpts((s) => ({ ...s, modelType: v as "standard" | "lowpoly" }))}
              options={[
                { value: "standard", label: t.relicCollection.meshy3dModelTypeStandard },
                { value: "lowpoly", label: t.relicCollection.meshy3dModelTypeLowpoly },
              ]}
            />
          </Field>
          <Field label={t.relicCollection.meshy3dSymmetry}>
            <NativeSelect
              value={opts.symmetryMode}
              onChange={(v) =>
                setOpts((s) => ({ ...s, symmetryMode: v as "auto" | "on" | "off" }))
              }
              options={[
                { value: "auto", label: t.relicCollection.meshy3dSymmetryAuto },
                { value: "on", label: t.relicCollection.meshy3dSymmetryOn },
                { value: "off", label: t.relicCollection.meshy3dSymmetryOff },
              ]}
            />
          </Field>
        </div>

        {/* Polycount */}
        <Field
          label={t.relicCollection.meshy3dPolycount}
          hint={t.relicCollection.meshy3dPolycountHint}
        >
          <input
            type="number"
            min={100}
            max={300_000}
            inputMode="numeric"
            placeholder="30000"
            value={polycountText}
            onChange={(e) => setPolycountText(e.target.value)}
            className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/40 focus:outline-none focus:border-primary"
          />
        </Field>

        {/* Texture prompt */}
        <Field
          label={t.relicCollection.meshy3dTexturePrompt}
          hint={t.relicCollection.meshy3dTexturePromptHint}
        >
          <textarea
            value={opts.texturePrompt ?? ""}
            onChange={(e) => setOpts((s) => ({ ...s, texturePrompt: e.target.value }))}
            maxLength={600}
            rows={2}
            placeholder="weathered bronze, dark patina"
            className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/40 focus:outline-none focus:border-primary resize-y"
          />
        </Field>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-3 border-t border-primary/15">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant hover:text-on-surface"
          >
            {t.relicCollection.meshy3dCancel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90"
          >
            {t.relicCollection.meshy3dConfirm}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-3 text-left p-2 hover:bg-primary/5 border border-primary/15"
    >
      <span
        aria-hidden
        className={[
          "material-symbols-outlined text-[20px] shrink-0 mt-0.5",
          checked ? "text-secondary" : "text-on-surface-variant/40",
        ].join(" ")}
      >
        {checked ? "check_circle" : "radio_button_unchecked"}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`block font-label text-[11px] tracking-[0.22em] uppercase ${
            checked ? "text-secondary" : "text-on-surface"
          }`}
        >
          {label}
        </span>
        <span className="block text-[11px] text-on-surface-variant/70 mt-0.5">{hint}</span>
      </span>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[11px] text-on-surface-variant/60 mt-1">{hint}</span>
      ) : null}
    </label>
  );
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
