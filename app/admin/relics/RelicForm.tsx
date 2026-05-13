"use client";

// Admin-only edit/create modal for Relic. Mirrors DraftPreviewBody's
// information layout (AssetCard → MetaFields → LoreFields → candidates)
// so admins move between draft-confirm and post-creation editing without
// learning a new form. Adds edit-only sections: regen, archive uploads
// (folded), password (folded).
//
// AssetCard in edit mode unlocks 2D/3D generation; jobs poll inline and
// refetch the relic on completion so the form reflects the new state.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { type CandidateImage } from "./CandidateImageGallery";
import CandidateThumbGrid from "./CandidateThumbGrid";
import OtherMaterialsGrid, { type Material } from "./OtherMaterialsGrid";
import AddMaterialModal from "./AddMaterialModal";
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
  materials: Material[];
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
  materials: [],
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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const networkFileInputRef = useRef<HTMLInputElement | null>(null);
  const [materialModalOpen, setMaterialModalOpen] = useState(false);

  async function uploadCandidate(file: File, source: "user" | "network") {
    if (!initial) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("source", source);
      const res = await fetch(`/api/relics/${initial.id}/candidate`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { errorMessage?: string; error?: string };
        setError(j.errorMessage ?? j.error ?? "upload failed");
        return;
      }
      const j = (await res.json()) as { candidate: CandidateImage };
      setState((s) => ({
        ...s,
        candidateImages: [...(s.candidateImages ?? []), j.candidate],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

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
          materials: Array.isArray(d.materials) ? (d.materials as Material[]) : [],
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
          materials: Array.isArray(d.materials) ? (d.materials as Material[]) : [],
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
      materials: state.materials,
      ...(state.primaryImagePath !== null ? { primaryImagePath: state.primaryImagePath } : {}),
      // modelPath / archivePath / derivedArchivePath are not editable in this
      // form. Don't round-trip them — legacy values may not match the
      // validator's strict path regex and would fail PATCH unnecessarily.
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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-hidden"
    >
      <form
        onSubmit={submit}
        style={{ zoom: 0.9 }}
        className="w-full max-w-6xl max-h-[100vh] overflow-hidden border border-primary/40 bg-background/95 p-6 space-y-5 shadow-[0_0_40px_rgba(82,253,207,0.12)]"
      >
        <h2 className="font-headline text-xl text-primary tracking-wide uppercase mb-2">
          {isEdit
            ? t.adminRelics.formEdit.replace("{{slot}}", String(state.slot).padStart(3, "0"))
            : t.adminRelics.formNew}
        </h2>

        {/* Two-column layout: left = asset card + basic info, right = 3 asset modules */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left column — asset card + basic info */}
          <div className="lg:col-span-7 flex flex-col gap-5 min-h-0">
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
                primaryPathOverride={state.primaryImagePath}
                isAdmin
                detailSlug={state.slug}
                onAssetUpdated={() => void refetchRelic()}
                t={t}
              />
            ) : null}

            {/* Slot + slug — only shown when creating; edit shows slot in title */}
            {!isEdit ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label={t.adminRelics.fSlot}>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    required
                    value={state.slot}
                    onChange={(e) => set("slot", Number(e.target.value))}
                    className={inputClass}
                  />
                </Field>
                <Field label={t.adminRelics.fSlug}>
                  <input
                    type="text"
                    required
                    pattern="[a-z0-9-]+"
                    value={state.slug}
                    onChange={(e) => set("slug", e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
            ) : null}

            {/* 命名与分类 */}
            <MetaFields
              value={state.meta}
              onChange={(meta) => setState((s) => ({ ...s, meta }))}
              disabled={pending}
              required
              t={t}
            />

            {/* 圣记 — fills remaining left-column height so its bottom
                aligns with the right column's last module. */}
            <div className="flex-1 min-h-[200px]">
              <LoreFields
                loreEn={state.loreEn}
                loreZh={state.loreZh}
                onChange={(next) =>
                  setState((s) => ({ ...s, loreEn: next.loreEn, loreZh: next.loreZh }))
                }
                disabled={pending}
                fillHeight
                t={t}
              />
            </div>

            {/* 圣印密语 — only when rarity = SPECIAL.
                New SPECIAL (no retained password) → required input.
                Existing SPECIAL with passwordHash → optional. */}
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
          </div>

          {/* Right column — 3 asset modules */}
          <div className="lg:col-span-5 space-y-4">
            <AssetModule title={t.adminRelics.modTitleUser}>
              {isEdit && initial ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadCandidate(f, "user");
                      e.target.value = "";
                    }}
                  />
                  <CandidateThumbGrid
                    relicId={initial.id}
                    candidates={(state.candidateImages ?? []).filter((c) => c.source === "user")}
                    primaryPath={state.primaryImagePath}
                    onChange={(next) => {
                      const others = (state.candidateImages ?? []).filter((c) => c.source !== "user");
                      setState((s) => ({
                        ...s,
                        candidateImages: [...others, ...next.candidates],
                        primaryImagePath: next.primaryPath,
                      }));
                    }}
                    onAddRequest={() => fileInputRef.current?.click()}
                    disabled={pending || uploading}
                    assetUrlFor={(rid, p) =>
                      `/api/relics/${rid}/candidate?path=${encodeURIComponent(p)}`
                    }
                  />
                </>
              ) : (
                <EmptyModule label={t.adminRelics.modEmptyUser} />
              )}
            </AssetModule>

            <AssetModule title={t.adminRelics.modTitleNetwork}>
              {isEdit && initial ? (
                <>
                  <input
                    ref={networkFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadCandidate(f, "network");
                      e.target.value = "";
                    }}
                  />
                  <CandidateThumbGrid
                    relicId={initial.id}
                    candidates={(state.candidateImages ?? []).filter((c) => c.source === "network")}
                    primaryPath={state.primaryImagePath}
                    onChange={(next) => {
                      const others = (state.candidateImages ?? []).filter((c) => c.source !== "network");
                      setState((s) => ({
                        ...s,
                        candidateImages: [...others, ...next.candidates],
                        // Network reorder/delete must not touch the relic's
                        // primaryImagePath (which lives in the user module).
                        primaryImagePath: s.primaryImagePath,
                      }));
                    }}
                    onAddRequest={() => networkFileInputRef.current?.click()}
                    disabled={pending || uploading}
                    hidePrimary
                    assetUrlFor={(rid, p) =>
                      `/api/relics/${rid}/candidate?path=${encodeURIComponent(p)}`
                    }
                  />
                </>
              ) : (
                <EmptyModule label={t.adminRelics.modEmptyNetwork} />
              )}
            </AssetModule>

            <AssetModule title={t.adminRelics.modTitleMaterials}>
              {isEdit && initial ? (
                <OtherMaterialsGrid
                  relicId={initial.id}
                  materials={state.materials}
                  onChange={(next) => setState((s) => ({ ...s, materials: next }))}
                  onAddRequest={() => setMaterialModalOpen(true)}
                  disabled={pending}
                />
              ) : (
                <EmptyModule label={t.adminRelics.modComingSoon} />
              )}
            </AssetModule>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-primary/10">
          {error ? (
            <p
              role="alert"
              className="flex-1 min-w-0 font-label text-[11px] tracking-[0.2em] uppercase text-error truncate"
              title={error}
            >
              {error}
            </p>
          ) : (
            <div className="flex-1" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface"
          >
            {t.adminRelics.cancel}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
          >
            {pending ? t.adminRelics.saving : t.adminRelics.save}
          </button>
        </div>
      </form>
      {materialModalOpen && initial ? (
        <AddMaterialModal
          relicId={initial.id}
          onClose={() => setMaterialModalOpen(false)}
          onAdded={(m) => setState((s) => ({ ...s, materials: [...s.materials, m] }))}
        />
      ) : null}
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

function AssetModule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-primary/20 bg-background/40 p-3 space-y-2">
      <p className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
        {title}
      </p>
      {children}
    </div>
  );
}

function EmptyModule({ label }: { label: string }) {
  return (
    <p className="text-[11px] text-on-surface-variant/60 italic py-3 text-center">
      {label}
    </p>
  );
}
