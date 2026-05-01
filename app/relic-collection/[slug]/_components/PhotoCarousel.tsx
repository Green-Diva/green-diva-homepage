"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  relicId: string;
  count: number;
  alt: string;
};

export default function PhotoCarousel({ relicId, count, alt }: Props) {
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (active === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
      if (e.key === "ArrowLeft") setActive((i) => (i === null ? null : (i - 1 + count) % count));
      if (e.key === "ArrowRight") setActive((i) => (i === null ? null : (i + 1) % count));
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [active, count]);

  if (count === 0) return null;

  return (
    <>
      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className="relative aspect-square border border-primary/20 hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary overflow-hidden bg-surface-container/40"
            aria-label={`${alt} · ${i + 1}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/relics/${relicId}/photos/${i}`}
              alt={`${alt} · ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>

      {active !== null
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              onClick={() => setActive(null)}
              className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/relics/${relicId}/photos/${active}`}
                alt={`${alt} · ${active + 1}`}
                className="max-w-[95vw] max-h-[90vh] object-contain"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive(null);
                }}
                aria-label="Close"
                className="absolute top-5 right-5 w-10 h-10 flex items-center justify-center border border-primary/40 text-primary hover:bg-primary/10"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
