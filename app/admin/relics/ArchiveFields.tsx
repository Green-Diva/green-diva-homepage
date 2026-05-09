"use client";

// §7 资料包 — legacy upload section in RelicForm. New pipeline writes
// these via runner hooks; manual upload is kept as a fallback and folded
// into a <details> so it doesn't dominate the form.

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/types";

type UploadKind = "model" | "photo" | "archive" | "derived";

const inputClass =
  "w-full bg-transparent border border-primary/20 focus:border-primary/60 outline-none px-2 py-1.5 text-on-surface text-[13px]";

export default function ArchiveFields({
  slug,
  archivePath,
  derivedArchivePath,
  photoPaths,
  modelPath,
  onChange,
  disabled,
  t,
}: {
  slug: string;
  archivePath: string;
  derivedArchivePath: string;
  photoPaths: string[];
  modelPath: string;
  onChange: (next: {
    archivePath: string;
    derivedArchivePath: string;
    photoPaths: string[];
    modelPath: string;
  }) => void;
  disabled?: boolean;
  t: Dictionary;
}) {
  const [uploading, setUploading] = useState<UploadKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<{
    archivePath: string;
    derivedArchivePath: string;
    photoPaths: string[];
    modelPath: string;
  }>) {
    onChange({ archivePath, derivedArchivePath, photoPaths, modelPath, ...p });
  }

  async function upload(kind: UploadKind, file: File) {
    if (!slug) {
      setError(t.adminRelics.uploadFailed + " · slug required");
      return;
    }
    setUploading(kind);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("slug", slug);
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await fetch("/api/admin/relics/upload", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => null)) as { path?: string } | null;
      if (!res.ok || !json?.path) {
        setError(t.adminRelics.uploadFailed);
        return;
      }
      if (kind === "model") patch({ modelPath: json.path });
      else if (kind === "archive") patch({ archivePath: json.path });
      else if (kind === "derived") patch({ derivedArchivePath: json.path });
      else patch({ photoPaths: [...photoPaths, json.path] });
    } catch {
      setError(t.adminRelics.uploadFailed);
    } finally {
      setUploading(null);
    }
  }

  return (
    <details className="border border-primary/15 bg-surface-container/20">
      <summary className="cursor-pointer px-3 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant hover:text-primary select-none">
        {t.adminRelics.fArchive} / {t.adminRelics.fDerived} / {t.adminRelics.fPhotos} / {t.adminRelics.fModel}
      </summary>
      <div className="p-3 space-y-3 border-t border-primary/10">
        <FileRow
          label={t.adminRelics.fArchive}
          value={archivePath}
          uploadLabel={
            uploading === "archive" ? t.adminRelics.uploading : t.adminRelics.uploadArchive
          }
          accept=".zip,application/zip,application/x-zip-compressed"
          placeholder="/{slug}/archive-….zip"
          readOnly
          disabled={disabled}
          onUpload={(f) => upload("archive", f)}
          onClear={() => patch({ archivePath: "" })}
        />
        <FileRow
          label={t.adminRelics.fDerived}
          value={derivedArchivePath}
          uploadLabel={
            uploading === "derived" ? t.adminRelics.uploading : t.adminRelics.uploadDerived
          }
          accept=".zip,application/zip,application/x-zip-compressed"
          placeholder="/{slug}/derived-….zip"
          readOnly
          disabled={disabled}
          onUpload={(f) => upload("derived", f)}
          onClear={() => patch({ derivedArchivePath: "" })}
        />
        <FileRow
          label={t.adminRelics.fModel}
          value={modelPath}
          uploadLabel={
            uploading === "model" ? t.adminRelics.uploading : t.adminRelics.uploadModel
          }
          accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
          placeholder="/holy-chalice/model.glb"
          disabled={disabled}
          onChangeText={(v) => patch({ modelPath: v })}
          onUpload={(f) => upload("model", f)}
        />

        <div className="space-y-2">
          <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
            {t.adminRelics.fPhotos}
          </span>
          <ul className="space-y-1">
            {photoPaths.map((p, i) => (
              <li
                key={p + i}
                className="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant border border-primary/10 px-2 py-1"
              >
                <span className="truncate">{p}</span>
                <button
                  type="button"
                  onClick={() => patch({ photoPaths: photoPaths.filter((_, j) => j !== i) })}
                  disabled={disabled}
                  className="font-label text-[10px] uppercase text-error hover:underline"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <label className="inline-block px-3 py-2 border border-primary/40 hover:bg-primary/10 cursor-pointer font-label text-[10px] tracking-[0.2em] uppercase text-primary">
            {uploading === "photo" ? t.adminRelics.uploading : t.adminRelics.uploadPhoto}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={disabled}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload("photo", f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        {error ? (
          <p
            role="alert"
            className="font-label text-[11px] tracking-[0.2em] uppercase text-error"
          >
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function FileRow({
  label,
  value,
  uploadLabel,
  accept,
  placeholder,
  readOnly,
  disabled,
  onChangeText,
  onUpload,
  onClear,
}: {
  label: string;
  value: string;
  uploadLabel: string;
  accept: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  onChangeText?: (v: string) => void;
  onUpload: (file: File) => void;
  onClear?: () => void;
}) {
  return (
    <label className="block">
      <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly={readOnly}
          value={value}
          onChange={(e) => onChangeText?.(e.target.value)}
          className={inputClass + (readOnly ? " opacity-70" : "")}
          placeholder={placeholder}
          disabled={disabled}
        />
        <label className="shrink-0 px-3 py-2 border border-primary/40 hover:bg-primary/10 cursor-pointer font-label text-[10px] tracking-[0.2em] uppercase text-primary">
          {uploadLabel}
          <input
            type="file"
            accept={accept}
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
        {value && onClear ? (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="shrink-0 font-label text-[10px] uppercase text-error hover:underline"
          >
            ×
          </button>
        ) : null}
      </div>
    </label>
  );
}
