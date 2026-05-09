"use client";

// Stage 3 of RelicDraftPanel — admin previews / edits AI-generated metadata
// before clicking 确认存入 / 放弃. Uses the same MetaFields / LoreFields /
// AssetCard / CandidateImageGallery as the post-creation RelicForm so the
// two flows feel like one continuous editor; only the framing differs:
// here AssetCard locks 2D/3D behind "存入后可生成" and the footer offers
// 放弃 / 确认存入 instead of 取消 / 保存.
//
// Field set is narrower than RelicForm — there are no archive/photo/model
// upload affordances or password yet because the relic itself doesn't
// exist; those appear only after confirm.

import { useState } from "react";
import CandidateImageGallery, {
  type CandidateImage,
} from "@/app/admin/relics/CandidateImageGallery";
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
  formKind?: "TWO_D" | "THREE_D" | null;
  formReason?: string | null;
  loreZh?: string | null;
  loreEn?: string | null;
  primaryImagePath?: string | null;
  candidateImages?: CandidateImage[] | null;
};

type Props = {
  draftId: string;
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
};

export default function DraftPreviewBody({
  draftId,
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
      formKind: initial.formKind ?? null,
      formReason: initial.formReason ?? "",
    },
    loreEn: initial.loreEn ?? "",
    loreZh: initial.loreZh ?? "",
    primaryImagePath: initial.primaryImagePath ?? null,
    candidateImages: Array.isArray(initial.candidateImages) ? initial.candidateImages : null,
  }));

  const candidateAssetUrl = (_id: string, path: string) =>
    `/api/relic-drafts/${draftId}/candidate?path=${encodeURIComponent(path)}`;

  function buildPayload(): DraftMetadata {
    return {
      nameEn: state.meta.nameEn,
      nameZh: state.meta.nameZh,
      classifEn: state.meta.classifEn,
      classifZh: state.meta.classifZh,
      rarity: state.meta.rarity,
      iconKey: state.meta.iconKey || null,
      formKind: state.meta.formKind,
      formReason: state.meta.formReason || null,
      loreEn: state.loreEn || null,
      loreZh: state.loreZh || null,
      primaryImagePath: state.primaryImagePath,
      candidateImages: state.candidateImages,
    };
  }

  return (
    <div className="space-y-5">
      {/* Header — title + subtitle */}
      <div>
        <p className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary mb-2">
          {t.relicCollection.draftPreviewTitle}
        </p>
        <p className="text-[12px] text-on-surface-variant leading-relaxed">
          {t.relicCollection.draftPreviewSubtitle}
        </p>
      </div>

      {/* §1 Asset card */}
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
        isAdmin={false}
        t={t}
      />

      {/* §2 命名与分类 */}
      <MetaFields
        value={state.meta}
        onChange={(meta) => setState((s) => ({ ...s, meta }))}
        disabled={busy}
        t={t}
      />

      {/* §4 圣记 */}
      <LoreFields
        loreEn={state.loreEn}
        loreZh={state.loreZh}
        onChange={(next) =>
          setState((s) => ({ ...s, loreEn: next.loreEn, loreZh: next.loreZh }))
        }
        disabled={busy}
        t={t}
      />

      {/* §5 候选图集 */}
      {Array.isArray(state.candidateImages) ? (
        <div className="space-y-2 border-t border-primary/10 pt-4">
          <CandidateImageGallery
            relicId={draftId}
            candidates={state.candidateImages}
            primaryPath={state.primaryImagePath}
            disabled={busy}
            assetUrlFor={candidateAssetUrl}
            onChange={(next) =>
              setState((s) => ({
                ...s,
                candidateImages: next.candidates,
                primaryImagePath: next.primaryPath,
              }))
            }
          />
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="font-label text-[11px] tracking-[0.2em] uppercase text-error border border-error/30 bg-error/10 px-3 py-2"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-primary/20">
        <button
          type="button"
          onClick={onAbandon}
          disabled={busy}
          className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-error border border-error/40 hover:bg-error/10 disabled:opacity-40"
        >
          {t.relicCollection.draftPreviewAbandon}
        </button>
        <button
          type="button"
          onClick={() => onSaveAndConfirm(buildPayload())}
          disabled={busy}
          className="px-5 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90 disabled:opacity-40"
        >
          {busy
            ? t.relicCollection.draftPreviewStoring
            : t.relicCollection.draftPreviewSaveAndStore}
        </button>
      </div>
    </div>
  );
}
