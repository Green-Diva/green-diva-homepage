"use client";

// 2×5 thumbnail grid for the relic's supporting materials: webpage URLs,
// document/image/archive uploads. Each filled slot shows the type icon +
// "<typeLabel><index>" (e.g. "图片1" / "网站1"). Clicking + opens an
// AddMaterialModal where admin picks the type and provides content.
//
// Materials are stored in Relic.materials Json. Files for uploaded
// kinds live at /<slug>/materials/<kind>-<ts>.<ext>. Reorder/delete on
// the grid edits the array in-place; saved via the form PATCH.

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import ImageLightbox from "./ImageLightbox";

export type Material = {
  kind: "webpage" | "image" | "document" | "archive";
  url?: string;
  path?: string;
  originalName?: string;
  addedAt?: string;
};

const MAX_SLOTS = 10;

type Props = {
  relicId: string;
  materials: Material[];
  onChange: (next: Material[]) => void;
  onAddRequest?: () => void;
  disabled?: boolean;
};

export default function OtherMaterialsGrid({
  relicId,
  materials,
  onChange,
  onAddRequest,
  disabled,
}: Props) {
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [imagePreview, setImagePreview] = useState<Material | null>(null);
  const shown = materials.slice(0, MAX_SLOTS);
  const emptyCount = Math.max(0, MAX_SLOTS - shown.length);

  const remove = (index: number) => {
    if (disabled) return;
    const next = materials.filter((_, i) => i !== index);
    setConfirmDelete(null);
    onChange(next);
  };

  // Derive the per-kind ordinal for labels (kind1, kind2, …).
  const ordinals = (() => {
    const counts: Record<string, number> = {};
    return shown.map((m) => {
      counts[m.kind] = (counts[m.kind] ?? 0) + 1;
      return counts[m.kind];
    });
  })();

  const kindLabel: Record<Material["kind"], string> = {
    webpage: t.adminRelics.materialKindWebpage,
    image: t.adminRelics.materialKindImage,
    document: t.adminRelics.materialKindDocument,
    archive: t.adminRelics.materialKindArchive,
  };

  const chips = shown.map((m, i) => {
    const ordinal = ordinals[i];
    const armed = confirmDelete === i;
    const title = m.url ?? m.originalName ?? m.path ?? "";
    const onClickChip = () => {
      if (armed) return;
      if (m.kind === "webpage" && m.url) {
        window.open(m.url, "_blank", "noopener");
      } else if (m.kind === "image" && m.path) {
        setImagePreview(m);
      } else if (m.kind === "document" && m.path) {
        // Open in a new tab — browser previews PDF/TXT/MD inline; DOC/DOCX
        // and other unsupported formats will fall back to download.
        window.open(
          `/api/relics/${relicId}/material?path=${encodeURIComponent(m.path)}`,
          "_blank",
          "noopener",
        );
      } else if (m.kind === "archive" && m.path) {
        const a = document.createElement("a");
        a.href = `/api/relics/${relicId}/material?path=${encodeURIComponent(m.path)}&download=1`;
        a.download = m.originalName ?? "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    };
    return (
      <div
        key={`${m.kind}-${i}-${m.path ?? m.url}`}
        className="group relative inline-flex items-center gap-1 px-1.5 py-0.5 font-label text-[11px] tracking-[0.1em] text-on-surface-variant hover:text-primary cursor-pointer min-h-[20px]"
        onClick={onClickChip}
        title={title}
      >
        <span>
          {kindLabel[m.kind]}
          {ordinal}
        </span>
        {!disabled ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (armed) {
                remove(i);
              } else {
                setConfirmDelete(i);
              }
            }}
            onMouseLeave={() => {
              if (armed) setConfirmDelete((p) => (p === i ? null : p));
            }}
            aria-label={armed ? t.adminRelics.candidateGalleryDeleteConfirm : t.adminRelics.candidateGalleryDelete}
            title={armed ? t.adminRelics.candidateGalleryDeleteConfirm : t.adminRelics.candidateGalleryDelete}
            className={[
              "cursor-pointer text-[#b91c1c] transition-opacity inline-flex",
              armed ? "opacity-100 animate-pulse" : "opacity-0 group-hover:opacity-100",
            ].join(" ")}
          >
            <span
              className="material-symbols-outlined text-[12px]"
              style={{ fontVariationSettings: "'FILL' 1, 'wght' 500" }}
            >
              {armed ? "delete_forever" : "delete"}
            </span>
          </button>
        ) : null}
      </div>
    );
  });

  const addButton = onAddRequest && shown.length < MAX_SLOTS && !disabled ? (
    <button
      type="button"
      onClick={onAddRequest}
      aria-label={t.adminRelics.candidateGalleryAdd}
      className="inline-flex items-center justify-start px-1.5 min-h-[20px] text-secondary/60 hover:text-secondary cursor-pointer"
    >
      <span className="material-symbols-outlined text-[16px]">add</span>
    </button>
  ) : null;

  // 2×5 grid with a fixed height equal to what two filled rows occupy,
  // so the module's overall height never jumps as materials are added.
  return (
    <>
      <div className="grid grid-cols-5 grid-rows-2 gap-x-2 gap-y-0.5 auto-rows-[20px] h-[42px]">
        {chips}
        {addButton}
      </div>
      {imagePreview && imagePreview.path ? (
        <ImageLightbox
          src={`/api/relics/${relicId}/material?path=${encodeURIComponent(imagePreview.path)}`}
          downloadUrl={`/api/relics/${relicId}/material?path=${encodeURIComponent(imagePreview.path)}&download=1`}
          downloadName={imagePreview.originalName}
          caption={imagePreview.originalName}
          onClose={() => setImagePreview(null)}
        />
      ) : null}
    </>
  );
}

