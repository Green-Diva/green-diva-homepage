"use client";

// Full-screen image preview overlay with download + close controls.
// Buttons sit in the image's own bottom-right corner via a relative
// inline-block wrapper so they stay glued to the image regardless of
// viewport size or image aspect ratio.

import { useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  src: string;
  downloadUrl?: string;
  downloadName?: string;
  caption?: string;
  // Optional "source page" link surfaced below the caption. Used by the
  // network-candidate grid so admins can jump from the image's CDN URL
  // (shown as caption) to the page it was found on for more context.
  sourceUrl?: string;
  sourceUrlLabel?: string;
  onClose: () => void;
};

export default function ImageLightbox({
  src,
  downloadUrl,
  downloadName,
  caption,
  sourceUrl,
  sourceUrlLabel,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/90 p-6"
    >
      <div
        className="relative inline-block max-w-full max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={caption ?? ""}
          className="block max-w-full max-h-[85vh] object-contain"
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-2">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download={downloadName ?? ""}
              aria-label="download"
              title="download"
              className="w-9 h-9 flex items-center justify-center bg-black/60 backdrop-blur-sm border border-secondary/60 text-secondary hover:bg-secondary/20 cursor-pointer"
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ fontVariationSettings: "'FILL' 0, 'wght' 400" }}
              >
                download
              </span>
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            title="close"
            className="w-9 h-9 flex items-center justify-center bg-black/60 backdrop-blur-sm border border-on-surface-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-on-surface/10 cursor-pointer"
          >
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ fontVariationSettings: "'FILL' 0, 'wght' 400" }}
            >
              close
            </span>
          </button>
        </div>
      </div>
      {caption || sourceUrl ? (
        <div className="mt-3 flex flex-col items-center gap-1.5 max-w-[92vw]">
          {caption ? (
            <p className="font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant truncate max-w-full">
              {caption}
            </p>
          ) : null}
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={sourceUrl}
              className="inline-flex items-center gap-1 font-label text-[11px] tracking-[0.2em] uppercase text-secondary hover:text-secondary/80 truncate max-w-full"
            >
              <span
                className="material-symbols-outlined text-[14px]"
                style={{ fontVariationSettings: "'FILL' 0, 'wght' 400" }}
              >
                open_in_new
              </span>
              <span className="truncate">{sourceUrlLabel ?? sourceUrl}</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
