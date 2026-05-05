"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";

const RARITIES = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;

export type RelicEditValue = {
  id: string;
  slot: number;
  slug: string;
  nameEn: string;
  nameZh: string;
  rarity: (typeof RARITIES)[number];
  hasPassword: boolean;
};

type FormState = {
  slot: number;
  slug: string;
  nameEn: string;
  nameZh: string;
  classifEn: string;
  classifZh: string;
  rarity: (typeof RARITIES)[number];
  iconKey: string;
  origin: string;
  acquiredAt: string;
  loreEn: string;
  loreZh: string;
  password: string;
  modelPath: string;
  photoPaths: string[];
  archivePath: string;
  derivedArchivePath: string;
};

const EMPTY: FormState = {
  slot: 1,
  slug: "",
  nameEn: "",
  nameZh: "",
  classifEn: "",
  classifZh: "",
  rarity: "COMMON",
  iconKey: "",
  origin: "",
  acquiredAt: "",
  loreEn: "",
  loreZh: "",
  password: "",
  modelPath: "",
  photoPaths: [],
  archivePath: "",
  derivedArchivePath: "",
};

export default function RelicForm({
  initial,
  presetSlot,
  onClose,
  onSaved,
}: {
  initial: RelicEditValue | null;
  presetSlot?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const isEdit = !!initial;
  const [state, setState] = useState<FormState>(() =>
    initial
      ? {
          ...EMPTY,
          slot: initial.slot,
          slug: initial.slug,
          nameEn: initial.nameEn,
          nameZh: initial.nameZh,
          rarity: initial.rarity,
        }
      : { ...EMPTY, slot: presetSlot ?? EMPTY.slot },
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"model" | "photo" | "archive" | "derived" | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!initial) return;
    // fetch full relic detail to populate fields (async, not synchronous in effect)
    fetch(`/api/relics/${initial.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setState({
          slot: d.slot,
          slug: d.slug,
          nameEn: d.nameEn ?? "",
          nameZh: d.nameZh ?? "",
          classifEn: d.classifEn ?? "",
          classifZh: d.classifZh ?? "",
          rarity: d.rarity,
          iconKey: d.iconKey ?? "",
          origin: d.origin ?? "",
          acquiredAt: d.acquiredAt ? String(d.acquiredAt).slice(0, 10) : "",
          loreEn: d.loreEn ?? "",
          loreZh: d.loreZh ?? "",
          password: "",
          modelPath: d.modelPath ?? "",
          photoPaths: Array.isArray(d.photoPaths) ? d.photoPaths : [],
          archivePath: d.archivePath ?? "",
          derivedArchivePath: d.derivedArchivePath ?? "",
        });
      });
  }, [initial]);

  if (typeof document === "undefined") return null;

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setState((s) => ({ ...s, [k]: v }));
  }

  async function upload(kind: "model" | "photo" | "archive" | "derived", file: File) {
    if (!state.slug) {
      setError(t.adminRelics.uploadFailed + " · slug required");
      return;
    }
    setUploading(kind);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("slug", state.slug);
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await fetch("/api/admin/relics/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.path) {
        setError(t.adminRelics.uploadFailed);
      } else if (kind === "model") {
        set("modelPath", json.path);
      } else if (kind === "archive") {
        set("archivePath", json.path);
      } else if (kind === "derived") {
        set("derivedArchivePath", json.path);
      } else {
        set("photoPaths", [...state.photoPaths, json.path]);
      }
    } catch {
      setError(t.adminRelics.uploadFailed);
    } finally {
      setUploading(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    const payload: Record<string, unknown> = {
      nameEn: state.nameEn.trim(),
      nameZh: state.nameZh.trim(),
      classifEn: state.classifEn.trim(),
      classifZh: state.classifZh.trim(),
      rarity: state.rarity,
      iconKey: state.iconKey || null,
      origin: state.origin || null,
      acquiredAt: state.acquiredAt ? new Date(state.acquiredAt).toISOString() : null,
      loreEn: state.loreEn || null,
      loreZh: state.loreZh || null,
      modelPath: state.modelPath || null,
      photoPaths: state.photoPaths,
      archivePath: state.archivePath || null,
      derivedArchivePath: state.derivedArchivePath || null,
    };
    if (!isEdit) {
      payload.slot = Number(state.slot);
      payload.slug = state.slug.trim();
    }
    if (state.password) payload.password = state.password;

    try {
      const url = isEdit ? `/api/relics/${initial!.id}` : "/api/relics";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onSaved();
      } else {
        const j = await res.json().catch(() => null);
        setError(typeof j?.error === "string" ? j.error : t.adminRelics.saveFailed);
      }
    } catch {
      setError(t.adminRelics.saveFailed);
    } finally {
      setPending(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-2xl my-8 border border-primary/40 bg-background/95 p-6 space-y-4 shadow-[0_0_40px_rgba(82,253,207,0.12)]"
      >
        <h2 className="font-headline text-xl text-primary tracking-wide uppercase mb-2">
          {isEdit ? t.adminRelics.formEdit : t.adminRelics.formNew}
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t.adminRelics.fSlot}>
            <input
              type="number"
              min={1}
              max={30}
              required
              readOnly={isEdit}
              disabled={isEdit}
              value={state.slot}
              onChange={(e) => set("slot", Number(e.target.value))}
              className={inputClass + (isEdit ? " opacity-50 cursor-not-allowed" : "")}
            />
          </Field>
          <Field label={t.adminRelics.fSlug}>
            <input
              type="text"
              required
              pattern="[a-z0-9-]+"
              readOnly={isEdit}
              disabled={isEdit}
              value={state.slug}
              onChange={(e) => set("slug", e.target.value)}
              className={inputClass + (isEdit ? " opacity-50 cursor-not-allowed" : "")}
            />
          </Field>
          <Field label={t.adminRelics.fNameEn}>
            <input type="text" required value={state.nameEn} onChange={(e) => set("nameEn", e.target.value)} className={inputClass} />
          </Field>
          <Field label={t.adminRelics.fNameZh}>
            <input type="text" required value={state.nameZh} onChange={(e) => set("nameZh", e.target.value)} className={inputClass} />
          </Field>
          <Field label={t.adminRelics.fClassifEn}>
            <input type="text" required value={state.classifEn} onChange={(e) => set("classifEn", e.target.value)} className={inputClass} />
          </Field>
          <Field label={t.adminRelics.fClassifZh}>
            <input type="text" required value={state.classifZh} onChange={(e) => set("classifZh", e.target.value)} className={inputClass} />
          </Field>
          <Field label={t.adminRelics.fRarity}>
            <select
              value={state.rarity}
              onChange={(e) => set("rarity", e.target.value as FormState["rarity"])}
              className={inputClass}
            >
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.adminRelics.fIcon}>
            <input type="text" value={state.iconKey} onChange={(e) => set("iconKey", e.target.value)} className={inputClass} placeholder="G  /  inventory_2" />
          </Field>
          <Field label={t.adminRelics.fOrigin}>
            <input type="text" value={state.origin} onChange={(e) => set("origin", e.target.value)} className={inputClass} />
          </Field>
          <Field label={t.adminRelics.fAcquired}>
            <input type="date" value={state.acquiredAt} onChange={(e) => set("acquiredAt", e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Field label={t.adminRelics.fLoreEn}>
          <textarea rows={3} value={state.loreEn} onChange={(e) => set("loreEn", e.target.value)} className={inputClass} />
        </Field>
        <Field label={t.adminRelics.fLoreZh}>
          <textarea rows={3} value={state.loreZh} onChange={(e) => set("loreZh", e.target.value)} className={inputClass} />
        </Field>

        <Field label={isEdit && initial?.hasPassword ? t.adminRelics.fPasswordKeep : t.adminRelics.fPassword}>
          <input
            type="password"
            autoComplete="new-password"
            value={state.password}
            onChange={(e) => set("password", e.target.value)}
            className={inputClass}
            placeholder={state.rarity === "SPECIAL" ? "•••••••" : "—"}
          />
        </Field>

        <Field label={t.adminRelics.fModel}>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={state.modelPath}
              onChange={(e) => set("modelPath", e.target.value)}
              className={inputClass}
              placeholder="/holy-chalice/model.glb"
            />
            <label className="shrink-0 px-3 py-2 border border-primary/40 hover:bg-primary/10 cursor-pointer font-label text-[10px] tracking-[0.2em] uppercase text-primary">
              {uploading === "model" ? t.adminRelics.uploading : t.adminRelics.uploadModel}
              <input
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload("model", f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </Field>

        <Field label={t.adminRelics.fArchive}>
          <div className="flex items-center gap-3">
            <input
              type="text"
              readOnly
              value={state.archivePath}
              className={inputClass + " opacity-70"}
              placeholder="/{slug}/archive-….zip"
            />
            <label className="shrink-0 px-3 py-2 border border-primary/40 hover:bg-primary/10 cursor-pointer font-label text-[10px] tracking-[0.2em] uppercase text-primary">
              {uploading === "archive" ? t.adminRelics.uploading : t.adminRelics.uploadArchive}
              <input
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload("archive", f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {state.archivePath ? (
              <button
                type="button"
                onClick={() => set("archivePath", "")}
                className="shrink-0 font-label text-[10px] uppercase text-error hover:underline"
              >
                ×
              </button>
            ) : null}
          </div>
        </Field>

        <Field label={t.adminRelics.fDerived}>
          <div className="flex items-center gap-3">
            <input
              type="text"
              readOnly
              value={state.derivedArchivePath}
              className={inputClass + " opacity-70"}
              placeholder="/{slug}/derived-….zip"
            />
            <label className="shrink-0 px-3 py-2 border border-primary/40 hover:bg-primary/10 cursor-pointer font-label text-[10px] tracking-[0.2em] uppercase text-primary">
              {uploading === "derived" ? t.adminRelics.uploading : t.adminRelics.uploadDerived}
              <input
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload("derived", f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {state.derivedArchivePath ? (
              <button
                type="button"
                onClick={() => set("derivedArchivePath", "")}
                className="shrink-0 font-label text-[10px] uppercase text-error hover:underline"
              >
                ×
              </button>
            ) : null}
          </div>
        </Field>

        <Field label={t.adminRelics.fPhotos}>
          <div className="space-y-2">
            <ul className="space-y-1">
              {state.photoPaths.map((p, i) => (
                <li key={p + i} className="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant border border-primary/10 px-2 py-1">
                  <span className="truncate">{p}</span>
                  <button
                    type="button"
                    onClick={() => set("photoPaths", state.photoPaths.filter((_, j) => j !== i))}
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
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload("photo", f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </Field>

        {error ? (
          <p role="alert" className="font-label text-[11px] tracking-[0.2em] uppercase text-error">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-3 pt-4 border-t border-primary/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface"
          >
            {t.adminRelics.cancel}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
          >
            {pending ? t.adminRelics.saving : t.adminRelics.save}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

const inputClass =
  "w-full bg-transparent border border-primary/20 focus:border-primary/60 outline-none px-2 py-1.5 text-on-surface text-[13px]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
