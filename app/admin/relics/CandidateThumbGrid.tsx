"use client";

// Compact 4×2 thumbnail grid (max 8 slots) used in the right column of
// the relic edit form. Each filled slot shows a candidate's thumbnail
// with primary / delete affordances; empty slots show a "+" dashed
// placeholder that fires onAddRequest when clicked (parent decides what
// "add" means — file picker for user uploads, URL prompt for network,
// etc.). When candidates exceed MAX_SLOTS, extra ones get a small
// overflow indicator on the last tile (clicking opens lightbox of all).

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useT } from "@/lib/i18n/client";
import type { CandidateImage } from "./CandidateImageGallery";
import ImageLightbox from "./ImageLightbox";

const MAX_SLOTS = 8;

type Props = {
  relicId: string;
  candidates: CandidateImage[];
  primaryPath: string | null;
  onChange: (next: { candidates: CandidateImage[]; primaryPath: string | null }) => void;
  onAddRequest?: () => void;
  disabled?: boolean;
  /** When true, do not show the PRIMARY badge — used by the network module
   * where the first image is not promoted to the relic's primary asset. */
  hidePrimary?: boolean;
  assetUrlFor: (relicId: string, path: string) => string;
};

export default function CandidateThumbGrid({
  relicId,
  candidates,
  onChange,
  onAddRequest,
  disabled,
  hidePrimary,
  assetUrlFor,
}: Props) {
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const visible = candidates.filter((c) => !c.deleted);
  const shown = visible.slice(0, MAX_SLOTS);
  const emptyCount = Math.max(0, MAX_SLOTS - shown.length);
  // Primary is always the first visible candidate — no manual toggle.
  const primaryIdentityPath = shown[0]?.path ?? null;

  // Mount dnd-kit after hydration to avoid SSR/CSR aria-id mismatches.
  const [dndMounted, setDndMounted] = useState(false);
  useEffect(() => {
    setDndMounted(true);
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Auto-arm-disarm: clicking trash arms; clicking again confirms; clicking
  // anywhere else dismisses. Reset whenever the visible set changes.
  useEffect(() => {
    if (confirmDelete && !shown.some((c) => c.path === confirmDelete)) {
      setConfirmDelete(null);
    }
  }, [shown, confirmDelete]);

  const remove = (path: string) => {
    if (disabled) return;
    const next = candidates.map((c) => (c.path === path ? { ...c, deleted: true } : c));
    const newPrimary = next.find((c) => !c.deleted)?.path ?? null;
    setConfirmDelete(null);
    onChange({ candidates: next, primaryPath: newPrimary });
  };

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromVisible = shown.findIndex((c) => c.path === String(active.id));
    const toVisible = shown.findIndex((c) => c.path === String(over.id));
    if (fromVisible < 0 || toVisible < 0) return;
    const nextVisible = arrayMove(shown, fromVisible, toVisible);
    let cursor = 0;
    const visiblePaths = new Set(shown.map((c) => c.path));
    const next = candidates.map((c) => {
      if (visiblePaths.has(c.path)) {
        const slot = nextVisible[cursor++];
        return slot ?? c;
      }
      return c;
    });
    onChange({ candidates: next, primaryPath: nextVisible[0]?.path ?? null });
  }

  const tiles = shown.map((c) => {
    const isPrimary = !hidePrimary && primaryIdentityPath === c.path;
    const armed = confirmDelete === c.path;
    return (
      <SortableTile
        key={c.path}
        id={c.path}
        disabled={!!disabled || !dndMounted}
      >
        <div
          className={[
            "relative aspect-square border bg-background/40 overflow-hidden",
            isPrimary ? "border-secondary/70" : "border-primary/15 hover:border-primary/35",
          ].join(" ")}
          title={c.originalFilename ?? c.path}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrlFor(relicId, c.path)}
            alt=""
            className="w-full h-full object-cover pointer-events-none select-none"
            draggable={false}
          />
          {isPrimary ? (
            <span className="absolute top-0.5 left-0.5 px-1 py-0.5 bg-secondary/90 text-background font-label text-[8px] tracking-[0.15em] uppercase pointer-events-none">
              {t.adminRelics.candidateGalleryPrimary}
            </span>
          ) : null}
          {/* Magnifier — top-right. Opens full-size preview lightbox. */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setPreviewPath(c.path);
            }}
            aria-label="preview"
            title="preview"
            className="absolute top-0.5 right-0.5 w-6 h-6 flex items-center justify-center cursor-pointer text-on-surface/80 hover:text-on-surface drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]"
          >
            <span
              className="material-symbols-outlined text-[16px]"
              style={{ fontVariationSettings: "'FILL' 0, 'wght' 500" }}
            >
              zoom_in
            </span>
          </button>
          {/* Trash icon — bottom-right. First click arms; second click deletes. */}
          {!disabled ? (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (armed) {
                  remove(c.path);
                } else {
                  setConfirmDelete(c.path);
                }
              }}
              onMouseLeave={() => {
                if (armed) setConfirmDelete((p) => (p === c.path ? null : p));
              }}
              aria-label={armed ? t.adminRelics.candidateGalleryDeleteConfirm : t.adminRelics.candidateGalleryDelete}
              title={armed ? t.adminRelics.candidateGalleryDeleteConfirm : t.adminRelics.candidateGalleryDelete}
              className={[
                "absolute bottom-0.5 right-0.5 w-6 h-6 flex items-center justify-center cursor-pointer text-[#b91c1c]",
                armed ? "animate-pulse" : "",
              ].join(" ")}
            >
              <span
                className="material-symbols-outlined text-[16px]"
                style={{ fontVariationSettings: "'FILL' 1, 'wght' 500" }}
              >
                {armed ? "delete_forever" : "delete"}
              </span>
            </button>
          ) : null}
        </div>
      </SortableTile>
    );
  });

  const emptySlots = Array.from({ length: emptyCount }).map((_, i) => {
    const isFirstEmpty = i === 0;
    const clickable = isFirstEmpty && !disabled && !!onAddRequest;
    return (
      <button
        type="button"
        key={`empty-${i}`}
        onClick={clickable ? onAddRequest : undefined}
        disabled={!clickable}
        className={[
          "aspect-square border border-dashed border-primary/20 flex items-center justify-center",
          clickable
            ? "hover:border-secondary/60 hover:bg-secondary/[0.04] cursor-pointer text-secondary/60 hover:text-secondary"
            : "text-on-surface-variant/20 cursor-default",
        ].join(" ")}
        aria-label={clickable ? t.adminRelics.candidateGalleryAdd : undefined}
      >
        <span className="material-symbols-outlined text-[24px]">add</span>
      </button>
    );
  });

  const grid = (
    <div className="grid grid-cols-4 gap-2">
      {tiles}
      {emptySlots}
    </div>
  );

  const previewCandidate = previewPath
    ? candidates.find((c) => c.path === previewPath)
    : null;
  const lightbox = previewCandidate ? (
    <ImageLightbox
      src={assetUrlFor(relicId, previewCandidate.path)}
      downloadUrl={`${assetUrlFor(relicId, previewCandidate.path)}&download=1`}
      downloadName={previewCandidate.originalFilename}
      caption={previewCandidate.originalFilename}
      onClose={() => setPreviewPath(null)}
    />
  ) : null;

  if (!dndMounted)
    return (
      <>
        {grid}
        {lightbox}
      </>
    );
  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={shown.map((c) => c.path)} strategy={rectSortingStrategy}>
          {grid}
        </SortableContext>
      </DndContext>
      {lightbox}
    </>
  );
}

function SortableTile({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: disabled ? undefined : isDragging ? "grabbing" : "grab",
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...(disabled ? {} : listeners)}>
      {children}
    </div>
  );
}
