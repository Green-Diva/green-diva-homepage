"use client";

// Multi-image curation block embedded in RelicForm. Renders the
// Smart Image Picker's candidate set:
//   - thumbnail (served via /api/relics/[id]/candidate?path=...)
//   - source badge (user / network)
//   - dimensions + filename
//   - "set as primary" radio (single-select)
//   - "delete" checkbox (soft delete; file stays on disk)
//
// Pure controlled component — emits onChange with the next array + the
// next primaryPath. RelicForm's submit handler folds this into PATCH.

import { useT } from "@/lib/i18n/client";

export type CandidateImage = {
  path: string;
  source: "user" | "network";
  originalFilename?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  score?: number;
  deleted?: boolean;
};

type Props = {
  relicId: string;
  candidates: CandidateImage[];
  primaryPath: string | null;
  onChange: (next: { candidates: CandidateImage[]; primaryPath: string | null }) => void;
  disabled?: boolean;
};

export default function CandidateImageGallery({
  relicId,
  candidates,
  primaryPath,
  onChange,
  disabled,
}: Props) {
  const t = useT();
  const visible = candidates.filter((c) => !c.deleted);
  const hidden = candidates.filter((c) => c.deleted);

  const setPrimary = (path: string) => {
    if (disabled) return;
    onChange({ candidates, primaryPath: path });
  };

  const toggleDeleted = (path: string, value: boolean) => {
    if (disabled) return;
    const next = candidates.map((c) =>
      c.path === path ? { ...c, deleted: value } : c,
    );
    // If we just deleted the primary, fall back to the first remaining visible
    // candidate as the primary.
    let nextPrimary = primaryPath;
    if (value && primaryPath === path) {
      const fallback = next.find((c) => !c.deleted)?.path ?? null;
      nextPrimary = fallback;
    }
    onChange({ candidates: next, primaryPath: nextPrimary });
  };

  if (candidates.length === 0) {
    return (
      <div className="text-[12px] text-on-surface-variant/70 italic">
        {t.adminRelics.candidateGalleryEmpty}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
        {t.adminRelics.candidateGalleryTitle.replace("{{n}}", String(visible.length))}
      </div>
      <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {visible.map((c) => (
          <CandidateRow
            key={c.path}
            relicId={relicId}
            candidate={c}
            isPrimary={primaryPath === c.path}
            onSetPrimary={() => setPrimary(c.path)}
            onDelete={() => toggleDeleted(c.path, true)}
            disabled={disabled}
          />
        ))}
      </ul>
      {hidden.length > 0 ? (
        <details className="text-[11px] text-on-surface-variant/60">
          <summary className="cursor-pointer">
            {t.adminRelics.candidateGalleryDeletedTitle.replace("{{n}}", String(hidden.length))}
          </summary>
          <ul className="space-y-1 mt-1 pl-2 border-l border-on-surface-variant/20">
            {hidden.map((c) => (
              <li key={c.path} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate flex-1">
                  {c.source} · {c.originalFilename ?? c.path}
                </span>
                <button
                  type="button"
                  onClick={() => toggleDeleted(c.path, false)}
                  disabled={disabled}
                  className="text-secondary hover:text-secondary/80 text-[10px] uppercase tracking-wider disabled:opacity-40"
                >
                  {t.adminRelics.candidateGalleryRestore}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function CandidateRow({
  relicId,
  candidate,
  isPrimary,
  onSetPrimary,
  onDelete,
  disabled,
}: {
  relicId: string;
  candidate: CandidateImage;
  isPrimary: boolean;
  onSetPrimary: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const sourceLabel =
    candidate.source === "network"
      ? t.adminRelics.candidateGallerySourceNet
      : t.adminRelics.candidateGallerySourceUser;
  const dims =
    candidate.width && candidate.height ? `${candidate.width}×${candidate.height}` : "";
  return (
    <li
      className={[
        "flex items-center gap-3 border px-2 py-2",
        isPrimary
          ? "border-secondary/70 bg-secondary/[0.06]"
          : "border-primary/15 hover:border-primary/35",
      ].join(" ")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/relics/${relicId}/candidate?path=${encodeURIComponent(candidate.path)}`}
        alt=""
        className="w-16 h-16 object-cover bg-background/40 shrink-0"
      />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span
            className={[
              "px-1.5 py-0.5 font-label text-[9px] tracking-[0.2em] uppercase border",
              candidate.source === "network"
                ? "border-primary/40 text-primary"
                : "border-on-surface-variant/40 text-on-surface-variant",
            ].join(" ")}
          >
            {sourceLabel}
          </span>
          {dims ? (
            <span className="text-[10px] text-on-surface-variant/70">{dims}</span>
          ) : null}
        </div>
        <div className="text-[11px] text-on-surface-variant truncate">
          {candidate.originalFilename ?? candidate.path}
        </div>
        {candidate.sourceUrl ? (
          <a
            href={candidate.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-primary/70 hover:text-primary truncate inline-block max-w-full"
          >
            {candidate.sourceUrl}
          </a>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <label className="flex items-center gap-1 cursor-pointer text-[10px]">
          <input
            type="radio"
            checked={isPrimary}
            onChange={onSetPrimary}
            disabled={disabled}
            className="accent-secondary"
          />
          <span className="font-label tracking-wider uppercase text-secondary">
            {t.adminRelics.candidateGalleryPrimary}
          </span>
        </label>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="text-[10px] text-error/80 hover:text-error font-label tracking-wider uppercase disabled:opacity-40"
        >
          {t.adminRelics.candidateGalleryDelete}
        </button>
      </div>
    </li>
  );
}
