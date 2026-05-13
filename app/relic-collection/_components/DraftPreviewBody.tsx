"use client";

// Stage 3 of RelicDraftPanel — admin previews / edits AI-generated metadata
// before clicking 确认存入 / 放弃. Mirrors RelicForm's 2-column layout so
// the two flows feel like one continuous editor. The two right-hand
// modules that don't make sense pre-creation (网络相关 / 其他资料) are
// rendered as grayed placeholders, and AssetCard's 2D/3D chips show as
// disabled pills with "存入后可生成" hint.

import { useState } from "react";
import type { CandidateImage } from "@/app/admin/relics/CandidateImageGallery";
import CandidateThumbGrid from "@/app/admin/relics/CandidateThumbGrid";
import AssetCard from "@/app/admin/relics/AssetCard";
import MetaFields, { type MetaFieldsValue } from "@/app/admin/relics/MetaFields";
import LoreFields from "@/app/admin/relics/LoreFields";
import { useT } from "@/lib/i18n/client";

export type DraftMetadata = {
  iconKey?: string | null;
  nameZh?: string;
  nameEn?: string;
  classifZh?: string;
  classifEn?: string;
  rarity?: "COMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPECIAL";
  loreZh?: string | null;
  loreEn?: string | null;
  primaryImagePath?: string | null;
  candidateImages?: CandidateImage[] | null;
  /** Raw passphrase for SPECIAL relics. Stored verbatim in the draft's
   * generatedMetadata until /confirm bcrypt-hashes it onto Relic. */
  password?: string;
};

type Props = {
  draftId: string;
  slot?: number;
  initial: DraftMetadata;
  busy: boolean;
  error: string | null;
  onAbandon: () => void;
  // PATCH the current state then POST /confirm. Admin always sees the
  // editor so there's no "store the AI output verbatim" affordance — if
  // they didn't edit, the PATCH just rewrites the current values.
  onSaveAndConfirm: (next: DraftMetadata) => Promise<void>;
};

type FormState = {
  meta: MetaFieldsValue;
  loreEn: string;
  loreZh: string;
  primaryImagePath: string | null;
  candidateImages: CandidateImage[] | null;
  password: string;
};

export default function DraftPreviewBody({
  draftId,
  slot,
  initial,
  busy,
  error,
  onAbandon,
  onSaveAndConfirm,
}: Props) {
  const t = useT();
  const [state, setState] = useState<FormState>(() => ({
    meta: {
      nameEn: initial.nameEn ?? "",
      nameZh: initial.nameZh ?? "",
      classifEn: initial.classifEn ?? "",
      classifZh: initial.classifZh ?? "",
      rarity: initial.rarity ?? "COMMON",
      iconKey: initial.iconKey ?? "",
    },
    loreEn: initial.loreEn ?? "",
    loreZh: initial.loreZh ?? "",
    primaryImagePath: initial.primaryImagePath ?? null,
    candidateImages: Array.isArray(initial.candidateImages) ? initial.candidateImages : null,
    password: initial.password ?? "",
  }));

  const candidateAssetUrl = (_id: string, p: string) =>
    `/api/relic-drafts/${draftId}/candidate?path=${encodeURIComponent(p)}`;

  function buildPayload(): DraftMetadata {
    return {
      nameEn: state.meta.nameEn,
      nameZh: state.meta.nameZh,
      classifEn: state.meta.classifEn,
      classifZh: state.meta.classifZh,
      rarity: state.meta.rarity,
      iconKey: state.meta.iconKey || null,
      loreEn: state.loreEn || null,
      loreZh: state.loreZh || null,
      primaryImagePath: state.primaryImagePath,
      candidateImages: state.candidateImages,
      ...(state.meta.rarity === "SPECIAL" && state.password ? { password: state.password } : {}),
    };
  }

  const userCandidates = (state.candidateImages ?? []).filter(
    (c) => c.source === "user",
  );
  const networkCandidates = (state.candidateImages ?? []).filter(
    (c) => c.source === "network",
  );

  return (
    <div className="space-y-5">
      <h2 className="font-headline text-xl text-primary tracking-wide uppercase">
        {typeof slot === "number"
          ? t.adminRelics.formEdit.replace("{{slot}}", String(slot).padStart(3, "0"))
          : t.adminRelics.formNew}
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left column — asset card + basic info */}
        <div className="lg:col-span-7 flex flex-col gap-5 min-h-0">
          {/* AssetCard in draft mode: 2D/3D chips render as disabled pills */}
          <AssetCard
            mode="draft"
            resourceId={draftId}
            hasPrimary={!!state.primaryImagePath}
            hasEnhanced={false}
            hasModel={false}
            nameZh={state.meta.nameZh}
            nameEn={state.meta.nameEn}
            classifZh={state.meta.classifZh}
            classifEn={state.meta.classifEn}
            iconKey={state.meta.iconKey}
            rarity={state.meta.rarity}
            isAdmin={false}
            t={t}
          />

          {/* 命名与分类 */}
          <MetaFields
            value={state.meta}
            onChange={(meta) => setState((s) => ({ ...s, meta }))}
            disabled={busy}
            t={t}
          />

          {/* 圣记 */}
          <div className="flex-1 min-h-[200px]">
            <LoreFields
              loreEn={state.loreEn}
              loreZh={state.loreZh}
              onChange={(next) =>
                setState((s) => ({ ...s, loreEn: next.loreEn, loreZh: next.loreZh }))
              }
              disabled={busy}
              fillHeight
              t={t}
            />
          </div>

          {/* 圣印密语 — SPECIAL only; mirrors RelicForm. /confirm hashes the
              raw value onto Relic.passwordHash and rejects empty values. */}
          {state.meta.rarity === "SPECIAL" ? (
            <div className="border border-primary/15 bg-surface-container/20 p-3 space-y-2">
              <label className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
                {t.adminRelics.fPassword}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={state.password}
                onChange={(e) => setState((s) => ({ ...s, password: e.target.value }))}
                disabled={busy}
                required
                minLength={4}
                className="w-full bg-transparent border border-primary/20 focus:border-primary/60 outline-none px-2 py-1.5 text-on-surface text-[13px]"
                placeholder="•••••••"
              />
            </div>
          ) : null}
        </div>

        {/* Right column — 3 asset modules */}
        <div className="lg:col-span-5 space-y-4">
          <AssetModule title={t.adminRelics.modTitleUser}>
            <CandidateThumbGrid
              relicId={draftId}
              candidates={userCandidates}
              primaryPath={state.primaryImagePath}
              onChange={(next) => {
                const others = (state.candidateImages ?? []).filter((c) => c.source !== "user");
                setState((s) => ({
                  ...s,
                  candidateImages: [...others, ...next.candidates],
                  primaryImagePath: next.primaryPath,
                }));
              }}
              disabled={busy}
              assetUrlFor={candidateAssetUrl}
            />
          </AssetModule>

          <DisabledModule
            title={t.adminRelics.modTitleNetwork}
            hint={t.relicCollection.draftPreviewPostStoreHint}
          >
            <CandidateThumbGrid
              relicId={draftId}
              candidates={networkCandidates}
              primaryPath={state.primaryImagePath}
              onChange={() => {}}
              disabled
              hidePrimary
              assetUrlFor={candidateAssetUrl}
            />
          </DisabledModule>

          <DisabledModule
            title={t.adminRelics.modTitleMaterials}
            hint={t.relicCollection.draftPreviewPostStoreHint}
          >
            <div className="grid grid-cols-5 grid-rows-2 gap-x-2 gap-y-0.5 auto-rows-[20px] h-[42px]" />
          </DisabledModule>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-primary/20">
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
          onClick={onAbandon}
          disabled={busy}
          className="shrink-0 px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-error border border-error/40 hover:bg-error/10 disabled:opacity-40"
        >
          {t.relicCollection.draftPreviewAbandon}
        </button>
        <button
          type="button"
          onClick={() => onSaveAndConfirm(buildPayload())}
          disabled={busy}
          className="shrink-0 px-5 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90 disabled:opacity-40"
        >
          {busy
            ? t.relicCollection.draftPreviewStoring
            : t.relicCollection.draftPreviewSaveAndStore}
        </button>
      </div>
    </div>
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

function DisabledModule({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative border border-primary/15 bg-background/30 p-3 space-y-2 opacity-50">
      <div className="flex items-center justify-between gap-2">
        <p className="font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant">
          {title}
        </p>
        <p className="font-label text-[9px] tracking-[0.15em] text-on-surface-variant/60 italic truncate">
          {hint}
        </p>
      </div>
      <div className="pointer-events-none">{children}</div>
    </div>
  );
}
