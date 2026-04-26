"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

export default function BioEditor({ initialBio }: { initialBio: string | null }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(initialBio ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setErr(null);
    const r = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio: bio.trim() ? bio : null }),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : t.bio.saveFailed);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="rounded-xl border border-primary/15 bg-surface-container/40 p-6">
        <div className="flex items-center justify-between">
          <span className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
            {t.bio.autobiography}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/70 hover:text-primary cursor-pointer"
          >
            {bio ? t.bio.revise : t.bio.inscribe}
          </button>
        </div>
        {bio ? (
          <p className="mt-4 text-sm text-on-surface font-light leading-[1.7] whitespace-pre-wrap">
            {bio}
          </p>
        ) : (
          <p className="mt-4 text-sm text-on-surface-variant font-light italic">
            {t.bio.emptyState}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-surface-container/60 p-6">
      <span className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
        {t.bio.autobiography}
      </span>
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={8}
        maxLength={2000}
        autoFocus
        placeholder={t.bio.placeholder}
        className="mt-3 w-full rounded-lg border border-primary/20 bg-background/60 px-3 py-2 text-sm text-on-surface focus:border-primary/50 focus:outline-none font-light leading-[1.7]"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant">
          {format(t.bio.counter, { count: bio.length })}
        </span>
        {err ? <span className="text-xs text-red-400">{err}</span> : null}
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="bg-primary/10 border border-primary/30 text-primary px-6 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg disabled:opacity-40 cursor-pointer"
        >
          {saving ? t.bio.pending : t.bio.seal}
        </button>
        <button
          type="button"
          onClick={() => {
            setBio(initialBio ?? "");
            setEditing(false);
            setErr(null);
          }}
          className="border border-primary/10 px-6 py-2 font-label tracking-widest uppercase text-[10px] text-gray-500 hover:text-primary hover:border-primary/30 transition-all rounded-lg cursor-pointer"
        >
          {t.bio.withdraw}
        </button>
      </div>
    </div>
  );
}
