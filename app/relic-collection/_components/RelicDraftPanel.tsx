"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";

const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_PER_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 30;
const ACCEPT_ATTR = [
  ".zip",
  "image/*",
  ".pdf",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".md", ".rtf", ".csv", ".json",
  "audio/*", "video/*",
].join(",");

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

type Props = {
  slot: number;
  onClose: () => void;
};

export default function RelicDraftPanel({ slot, onClose }: Props) {
  const t = useT();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, submitting]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (files.length === 0) {
      setError(t.relicCollection.draftPanelMissingFile);
      return;
    }
    if (files.length > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
      setError(t.relicCollection.draftPanelSubmitFailed);
      return;
    }
    if (files.some((f) => f.size > MAX_PER_FILE_BYTES)) {
      setError(t.relicCollection.draftPanelSubmitFailed);
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("slot", String(slot));
      fd.append("description", description);
      for (const f of files) fd.append("files", f, f.name);
      const r = await fetch("/api/relics/draft", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) {
        setSubmitting(false);
        setError(t.relicCollection.draftPanelSubmitFailed);
        return;
      }
      const json = (await r.json()) as { slug?: string };
      if (json.slug) {
        router.push(`/relic-collection/${json.slug}`);
      } else {
        router.refresh();
        onClose();
      }
    } catch (err) {
      console.error("[RelicDraftPanel] submit failed", err);
      setSubmitting(false);
      setError(t.relicCollection.draftPanelSubmitFailed);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <form
        onSubmit={submit}
        className="relative w-full max-w-2xl mt-12 mb-12 border border-primary/40 bg-surface-container/95 shadow-[0_0_42px_rgba(140,255,225,0.18)] p-6 sm:p-8 space-y-6"
      >
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-primary text-2xl tracking-wider">
              {t.relicCollection.draftPanelTitle}
            </h2>
            <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/75 mt-1">
              {t.relicCollection.cellSlot.replace("{{slot}}", String(slot).padStart(3, "0"))}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/75 hover:text-on-surface disabled:opacity-40"
          >
            {t.relicCollection.draftPanelCancel}
          </button>
        </div>

        <p className="text-sm text-on-surface-variant leading-relaxed">
          {t.relicCollection.draftPanelSubtitle}
        </p>

        <div className="space-y-2">
          <label className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
            {t.relicCollection.draftPanelArchiveLabel}
          </label>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setFiles((prev) => {
                // Merge with prior selection so the user can pick from
                // multiple folders without losing earlier picks.
                const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
                const merged = [...prev];
                for (const f of picked) {
                  const key = `${f.name}:${f.size}`;
                  if (!seen.has(key)) {
                    merged.push(f);
                    seen.add(key);
                  }
                }
                return merged.slice(0, MAX_FILES);
              });
              if (fileInput.current) fileInput.current.value = "";
            }}
            disabled={submitting}
            className="w-full text-sm text-on-surface file:mr-4 file:py-2 file:px-4 file:border file:border-primary/50 file:bg-transparent file:text-primary file:font-label file:text-[10px] file:tracking-[0.25em] file:uppercase file:cursor-pointer hover:file:bg-primary/10"
          />
          <p className="text-[11px] text-on-surface-variant/70">
            {t.relicCollection.draftPanelArchiveHint}
          </p>
          {files.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[12px] text-on-surface-variant max-h-40 overflow-y-auto border border-primary/10 px-3 py-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    {f.name}{" "}
                    <span className="text-on-surface-variant/60">({formatSize(f.size)})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFiles((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    disabled={submitting}
                    className="text-error/80 hover:text-error font-label text-[10px] tracking-[0.2em] uppercase shrink-0"
                  >
                    ×
                  </button>
                </li>
              ))}
              <li className="pt-1 border-t border-primary/10 text-on-surface-variant/60">
                {files.length} / {MAX_FILES} · {formatSize(totalBytes)} /{" "}
                {formatSize(MAX_TOTAL_BYTES)}
              </li>
            </ul>
          ) : null}
        </div>

        <div className="space-y-2">
          <label className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
            {t.relicCollection.draftPanelDescriptionLabel}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            maxLength={2000}
            rows={4}
            placeholder={t.relicCollection.draftPanelDescriptionPlaceholder}
            className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary resize-y"
          />
        </div>

        {error ? (
          <p className="text-sm text-error border border-error/30 bg-error/10 px-3 py-2">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-3 pt-2 border-t border-primary/20">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant hover:text-on-surface disabled:opacity-40"
          >
            {t.relicCollection.draftPanelCancel}
          </button>
          <button
            type="submit"
            disabled={submitting || files.length === 0}
            className="px-6 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90 disabled:bg-on-surface-variant/30 disabled:text-on-surface-variant disabled:cursor-not-allowed"
          >
            {submitting ? t.relicCollection.draftPanelSubmitting : t.relicCollection.draftPanelSubmit}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
