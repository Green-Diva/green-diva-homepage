"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Activity = {
  id: string;
  content: string;
  createdAt: string;
};

export default function ActivityList({ initial }: { initial: Activity[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.trim() }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : "Failed");
      return;
    }
    const created = await r.json();
    setItems((s) => [created, ...s]);
    setText("");
    router.refresh();
  }

  async function onDelete(id: string) {
    const r = await fetch(`/api/activities/${id}`, { method: "DELETE" });
    if (!r.ok) return;
    setItems((s) => s.filter((a) => a.id !== id));
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-primary/15 bg-surface-container/40 p-6">
      <div className="flex items-center justify-between">
        <span className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
          Current Dispatches
        </span>
        <span className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary/60 border border-secondary/20 px-2 py-0.5 rounded-full">
          AI polish · Awakening
        </span>
      </div>

      <form onSubmit={onAdd} className="mt-4 flex gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={280}
          placeholder="Today the vault hummed in B-flat…"
          className="flex-1 rounded-lg border border-primary/20 bg-background/60 px-3 py-2 text-sm text-on-surface focus:border-primary/50 focus:outline-none font-light"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="bg-primary/10 border border-primary/30 text-primary px-5 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg disabled:opacity-40 cursor-pointer"
        >
          {busy ? "…" : "Log"}
        </button>
      </form>
      {err ? <p className="mt-2 text-xs text-red-400">{err}</p> : null}

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-on-surface-variant font-light italic">
          No dispatches yet — the present is still being woven.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((a) => (
            <li
              key={a.id}
              className="group flex items-start gap-3 text-sm text-on-surface font-light"
            >
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
              <span className="flex-1 leading-[1.7]">{a.content}</span>
              <div className="flex items-center gap-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant">
                  {new Date(a.createdAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(a.id)}
                  className="font-label text-[9px] tracking-[0.3em] uppercase text-red-400 hover:text-red-300 cursor-pointer"
                >
                  remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
