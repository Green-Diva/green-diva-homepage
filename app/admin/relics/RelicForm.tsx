"use client";

// Admin-only edit/create modal for Relic. Mirrors DraftPreviewBody's
// information layout (AssetCard → MetaFields → LoreFields → candidates)
// so admins move between draft-confirm and post-creation editing without
// learning a new form. Adds edit-only sections: regen, archive uploads
// (folded), password (folded).
//
// AssetCard in edit mode unlocks 2D/3D generation; jobs poll inline and
// refetch the relic on completion so the form reflects the new state.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import CandidateImageGallery, {
  type CandidateImage,
} from "./CandidateImageGallery";
import AssetCard from "./AssetCard";
import MetaFields, { type MetaFieldsValue } from "./MetaFields";
import LoreFields from "./LoreFields";

const RARITIES = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;

export type RelicEditValue = {
  id: string;
  slot: number;
  slug: string;
  nameEn: string;
  nameZh: string;
  rarity: (typeof RARITIES)[number];
  hasPassword: boolean;
};

type FormState = {
  slot: number;
  slug: string;
  meta: MetaFieldsValue;
  loreEn: string;
  loreZh: string;
  password: string;
  modelPath: string;
  archivePath: string;
  derivedArchivePath: string;
  primaryImagePath: string | null;
  enhancedImagePath: string | null;
  candidateImages: CandidateImage[] | null;
};

const EMPTY: FormState = {
  slot: 1,
  slug: "",
  meta: {
    nameEn: "",
    nameZh: "",
    classifEn: "",
    classifZh: "",
    rarity: "COMMON",
    iconKey: "",
  },
  loreEn: "",
  loreZh: "",
  password: "",
  modelPath: "",
  archivePath: "",
  derivedArchivePath: "",
  primaryImagePath: null,
  enhancedImagePath: null,
  candidateImages: null,
};

const inputClass =
  "w-full bg-transparent border border-primary/20 focus:border-primary/60 outline-none px-2 py-1.5 text-on-surface text-[13px]";

export default function RelicForm({
  initial,
  presetSlot,
  onClose,
  onSaved,
}: {
  initial: RelicEditValue | null;
  presetSlot?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const isEdit = !!initial;
  const [state, setState] = useState<FormState>(() =>
    initial
      ? {
        ...EMPTY,
        slot: initial.slot,
        slug: initial.slug,
        meta: {
          ...EMPTY.meta,
          nameEn: initial.nameEn,
          nameZh: initial.nameZh,
          rarity: initial.rarity,
        },
      }
      : { ...EMPTY, slot: presetSlot ?? EMPTY.slot },
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Hydrate form from server. AssetCard.onAssetUpdated reuses this to
  // refresh after async 2D/3D jobs finish.
  function refetchRelic() {
    if (!initial) return;
    fetch(`/api/relics/${initial.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setState({
          slot: d.slot,
          slug: d.slug,
          meta: {
            nameEn: d.nameEn ?? "",
            nameZh: d.nameZh ?? "",
            classifEn: d.classifEn ?? "",
            classifZh: d.classifZh ?? "",
            rarity: d.rarity,
            iconKey: d.iconKey ?? "",
          },
          loreEn: d.loreEn ?? "",
          loreZh: d.loreZh ?? "",
          password: "",
          modelPath: d.modelPath ?? "",
          archivePath: d.archivePath ?? "",
          derivedArchivePath: d.derivedArchivePath ?? "",
          primaryImagePath: typeof d.primaryImagePath === "string" ? d.primaryImagePath : null,
          enhancedImagePath: typeof d.enhancedImagePath === "string" ? d.enhancedImagePath : null,
          candidateImages: Array.isArray(d.candidateImages)
            ? (d.candidateImages as CandidateImage[])
            : null,
        });
      });
  }

  useEffect(() => {
    if (!initial) return;
    fetch(`/api/relics/${initial.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setState({
          slot: d.slot,
          slug: d.slug,
          meta: {
            nameEn: d.nameEn ?? "",
            nameZh: d.nameZh ?? "",
            classifEn: d.classifEn ?? "",
            classifZh: d.classifZh ?? "",
            rarity: d.rarity,
            iconKey: d.iconKey ?? "",
          },
          loreEn: d.loreEn ?? "",
          loreZh: d.loreZh ?? "",
          password: "",
          modelPath: d.modelPath ?? "",
          archivePath: d.archivePath ?? "",
          derivedArchivePath: d.derivedArchivePath ?? "",
          primaryImagePath: typeof d.primaryImagePath === "string" ? d.primaryImagePath : null,
          enhancedImagePath: typeof d.enhancedImagePath === "string" ? d.enhancedImagePath : null,
          candidateImages: Array.isArray(d.candidateImages)
            ? (d.candidateImages as CandidateImage[])
            : null,
        });
      });
  }, [initial]);

  if (typeof document === "undefined") return null;

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setState((s) => ({ ...s, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    const payload: Record<string, unknown> = {
      nameEn: state.meta.nameEn.trim(),
      nameZh: state.meta.nameZh.trim(),
      classifEn: state.meta.classifEn.trim(),
      classifZh: state.meta.classifZh.trim(),
      rarity: state.meta.rarity,
      iconKey: state.meta.iconKey || null,
      loreEn: state.loreEn || null,
      loreZh: state.loreZh || null,
      ...(state.candidateImages !== null ? { candidateImages: state.candidateImages } : {}),
      ...(state.primaryImagePath !== null ? { primaryImagePath: state.primaryImagePath } : {}),
      modelPath: state.modelPath || null,
      archivePath: state.archivePath || null,
      derivedArchivePath: state.derivedArchivePath || null,
    };
    if (!isEdit) {
      payload.slot = Number(state.slot);
      payload.slug = state.slug.trim();
    }
    if (state.password) payload.password = state.password;

    try {
      const url = isEdit ? `/api/relics/${initial!.id}` : "/api/relics";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onSaved();
      } else {
        const j = await res.json().catch(() => null);
        setError(typeof j?.error === "string" ? j.error : t.adminRelics.saveFailed);
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
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-2xl my-8 border border-primary/40 bg-background/95 p-6 space-y-5 shadow-[0_0_40px_rgba(82,253,207,0.12)]"
      >
        <h2 className="font-headline text-xl text-primary tracking-wide uppercase mb-2">
          {isEdit ? t.adminRelics.formEdit : t.adminRelics.formNew}
        </h2>

        {/* §1 Asset card (edit only — new mode has no relicId yet) */}
        {isEdit && initial ? (
          <AssetCard
            mode="edit"
            resourceId={initial.id}
            hasPrimary={!!state.primaryImagePath}
            hasEnhanced={!!state.enhancedImagePath}
            hasModel={!!state.modelPath}
            nameZh={state.meta.nameZh}
            nameEn={state.meta.nameEn}
            classifZh={state.meta.classifZh}
            classifEn={state.meta.classifEn}
            iconKey={state.meta.iconKey}
            rarity={state.meta.rarity}
            isAdmin
            detailSlug={state.slug}
            onAssetUpdated={() => void refetchRelic()}
            t={t}
          />
        ) : null}

        {/* Slot + slug — top of edit-only metadata */}
        <div className="grid grid-cols-2 gap-4">
          <Field label={t.adminRelics.fSlot}>
            <input
              type="number"
              min={1}
              max={30}
              required
              readOnly={isEdit}
              disabled={isEdit}
              value={state.slot}
              onChange={(e) => set("slot", Number(e.target.value))}
              className={inputClass + (isEdit ? " opacity-50 cursor-not-allowed" : "")}
            />
          </Field>
          <Field label={t.adminRelics.fSlug}>
            <input
              type="text"
              required
              pattern="[a-z0-9-]+"
              readOnly={isEdit}
              disabled={isEdit}
              value={state.slug}
              onChange={(e) => set("slug", e.target.value)}
              className={inputClass + (isEdit ? " opacity-50 cursor-not-allowed" : "")}
            />
          </Field>
        </div>

        {/* §2 命名与分类 */}
        <MetaFields
          value={state.meta}
          onChange={(meta) => setState((s) => ({ ...s, meta }))}
          disabled={pending}
          required
          t={t}
        />

        {/* §3 圣记 */}
        <LoreFields
          loreEn={state.loreEn}
          loreZh={state.loreZh}
          onChange={(next) =>
            setState((s) => ({ ...s, loreEn: next.loreEn, loreZh: next.loreZh }))
          }
          disabled={pending}
          rows={3}
          t={t}
        />

        {/* §5 候选图集 — only meaningful when editing an existing
            relic that came through the AI pipeline */}
        {isEdit && initial && state.candidateImages !== null ? (
          <div className="space-y-3 border-t border-primary/10 pt-4">
            <CandidateImageGallery
              relicId={initial.id}
              candidates={state.candidateImages}
              primaryPath={state.primaryImagePath}
              onChange={(next) =>
                setState((s) => ({
                  ...s,
                  candidateImages: next.candidates,
                  primaryImagePath: next.primaryPath,
                }))
              }
              disabled={pending}
            />
          </div>
        ) : null}

        {/* §7 圣印密语 — only when rarity = SPECIAL.
            New SPECIAL (no retained password) → required input.
            Existing SPECIAL with passwordHash → optional (leave blank to keep). */}
        {state.meta.rarity === "SPECIAL" ? (
          <div className="border border-primary/15 bg-surface-container/20 p-3 space-y-2">
            <label className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
              {isEdit && initial?.hasPassword
                ? t.adminRelics.fPasswordKeep
                : t.adminRelics.fPassword}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={state.password}
              onChange={(e) => set("password", e.target.value)}
              disabled={pending}
              required={!(isEdit && initial?.hasPassword)}
              className={inputClass}
              placeholder="•••••••"
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="font-label text-[11px] tracking-[0.2em] uppercase text-error">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-3 pt-4 border-t border-primary/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface"
          >
            {t.adminRelics.cancel}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
          >
            {pending ? t.adminRelics.saving : t.adminRelics.save}
          </button>
        </div>
      </form>
    </div>,
    document.body,
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
