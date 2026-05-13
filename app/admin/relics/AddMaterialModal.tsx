"use client";

// Modal triggered from the "Other Materials" grid's + slot. Admin picks
// a type (webpage / image / document / archive) on the left; the right
// side shows the type-appropriate input (URL textbox for webpage, file
// picker otherwise). On submit:
//   - webpage: returns { kind: "webpage", url } directly (no upload)
//   - file kinds: POSTs to /api/relics/[id]/material → server saves
//     under private/relics/<slug>/materials/, returns the new Material

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import type { Material } from "./OtherMaterialsGrid";

type Kind = Material["kind"];

const KINDS: Kind[] = ["webpage", "image", "document", "archive"];

const KIND_ICON: Record<Kind, string> = {
  webpage: "language",
  image: "image",
  document: "description",
  archive: "folder_zip",
};

const ACCEPT: Record<Exclude<Kind, "webpage">, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml",
  document: ".pdf,.doc,.docx,.txt,.md,.rtf,.odt",
  archive: ".zip,.tar,.gz,.7z,.rar",
};

export default function AddMaterialModal({
  relicId,
  onClose,
  onAdded,
}: {
  relicId: string;
  onClose: () => void;
  onAdded: (material: Material) => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<Kind>("webpage");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const kindLabel: Record<Kind, string> = {
    webpage: t.adminRelics.materialKindWebpage,
    image: t.adminRelics.materialKindImage,
    document: t.adminRelics.materialKindDocument,
    archive: t.adminRelics.materialKindArchive,
  };

  async function handleSubmit() {
    setError(null);
    if (submitting) return;
    if (kind === "webpage") {
      const trimmed = url.trim();
      if (!trimmed) {
        setError(t.adminRelics.materialMissingUrl);
        return;
      }
      try {
        new URL(trimmed);
      } catch {
        setError(t.adminRelics.materialInvalidUrl);
        return;
      }
      onAdded({
        kind: "webpage",
        url: trimmed,
        addedAt: new Date().toISOString(),
      });
      onClose();
      return;
    }
    if (!file) {
      setError(t.adminRelics.materialMissingFile);
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const res = await fetch(`/api/relics/${relicId}/material`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { errorMessage?: string };
        setError(j.errorMessage ?? "upload failed");
        return;
      }
      const j = (await res.json()) as { material: Material };
      onAdded(j.material);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl border border-primary/40 bg-background/95 p-6 space-y-5 shadow-[0_0_40px_rgba(82,253,207,0.12)]">
        <h3 className="font-headline text-lg text-primary tracking-wide uppercase">
          {t.adminRelics.materialAddTitle}
        </h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Left — kind picker */}
          <div className="space-y-2">
            <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
              {t.adminRelics.materialKindPickerLabel}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => {
                const active = k === kind;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setKind(k);
                      setError(null);
                    }}
                    className={[
                      "flex flex-col items-center justify-center gap-1 aspect-square border transition-colors",
                      active
                        ? "border-secondary/70 bg-secondary/[0.08] text-secondary"
                        : "border-primary/20 hover:border-primary/40 text-on-surface-variant",
                    ].join(" ")}
                  >
                    <span
                      className="material-symbols-outlined text-[28px]"
                      style={{ fontVariationSettings: "'FILL' 0, 'wght' 300" }}
                    >
                      {KIND_ICON[k]}
                    </span>
                    <span className="font-label text-[10px] tracking-[0.2em] uppercase">
                      {kindLabel[k]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right — content input */}
          <div className="space-y-2">
            <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
              {t.adminRelics.materialContentLabel}
            </p>
            {kind === "webpage" ? (
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                autoFocus
                className="w-full bg-transparent border border-primary/20 focus:border-primary/60 outline-none px-2 py-1.5 text-on-surface text-[13px]"
              />
            ) : (
              <div className="space-y-1.5">
                <label className="block">
                  <input
                    type="file"
                    accept={ACCEPT[kind]}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setError(null);
                    }}
                    className="hidden"
                  />
                  <span className="inline-flex items-center justify-center w-full px-3 py-2 border border-secondary/60 text-secondary font-label text-[11px] tracking-[0.2em] uppercase hover:bg-secondary/10 cursor-pointer">
                    {file ? t.adminRelics.materialReplaceFile : t.adminRelics.materialChooseFile}
                  </span>
                </label>
                {file ? (
                  <p className="text-[11px] text-on-surface-variant truncate">{file.name}</p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="font-label text-[11px] tracking-[0.2em] uppercase text-error border border-error/30 bg-error/10 px-3 py-2"
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-3 pt-3 border-t border-primary/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface"
          >
            {t.adminRelics.cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
          >
            {submitting ? t.adminRelics.saving : t.adminRelics.materialAddConfirm}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
