"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ProjectFormValues = {
  id?: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  coverUrl: string;
  tags: string;
  link: string;
  repoUrl: string;
  order: number;
  published: boolean;
};

const empty: ProjectFormValues = {
  slug: "",
  title: "",
  summary: "",
  description: "",
  coverUrl: "",
  tags: "",
  link: "",
  repoUrl: "",
  order: 0,
  published: true,
};

export function ProjectForm({ initial, mode }: { initial?: Partial<ProjectFormValues>; mode: "create" | "edit" }) {
  const router = useRouter();
  const [values, setValues] = useState<ProjectFormValues>({ ...empty, ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    const body = {
      ...values,
      coverUrl: values.coverUrl || null,
      link: values.link || null,
      repoUrl: values.repoUrl || null,
      order: Number(values.order) || 0,
    };

    const url = mode === "create" ? "/api/projects" : `/api/projects/${values.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setBusy(false);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      setErr(JSON.stringify(e.error ?? r.statusText));
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  function field<K extends keyof ProjectFormValues>(key: K, v: ProjectFormValues[K]) {
    setValues((s) => ({ ...s, [key]: v }));
  }

  const input =
    "mt-2 w-full rounded-lg border border-primary/20 bg-surface-container px-3 py-2 text-sm text-on-surface focus:border-primary/50 focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-2xl space-y-6 px-8 py-14">
      <div>
        <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
          {mode === "create" ? "New Chronicle" : "Amend Chronicle"}
        </span>
        <h1 className="mt-2 font-headline text-4xl font-light text-primary sacred-glow">
          {mode === "create" ? "Inscribe" : "Revise"}
        </h1>
      </div>

      <label className="block">
        <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Slug</span>
        <input
          className={input}
          value={values.slug}
          onChange={(e) => field("slug", e.target.value)}
          placeholder="my-project"
          required
        />
      </label>

      <label className="block">
        <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Title</span>
        <input
          className={input}
          value={values.title}
          onChange={(e) => field("title", e.target.value)}
          required
        />
      </label>

      <label className="block">
        <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Summary</span>
        <textarea
          className={input}
          rows={2}
          value={values.summary}
          onChange={(e) => field("summary", e.target.value)}
          required
        />
      </label>

      <label className="block">
        <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Description (Markdown)</span>
        <textarea
          className={`${input} font-mono`}
          rows={10}
          value={values.description}
          onChange={(e) => field("description", e.target.value)}
          required
        />
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Tags (comma separated)</span>
          <input className={input} value={values.tags} onChange={(e) => field("tags", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Order</span>
          <input
            className={input}
            type="number"
            value={values.order}
            onChange={(e) => field("order", Number(e.target.value))}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Cover URL</span>
          <input className={input} value={values.coverUrl} onChange={(e) => field("coverUrl", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Live URL</span>
          <input className={input} value={values.link} onChange={(e) => field("link", e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Repo URL</span>
          <input className={input} value={values.repoUrl} onChange={(e) => field("repoUrl", e.target.value)} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.published}
          onChange={(e) => field("published", e.target.checked)}
        />
        Published
      </label>

      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      <div className="flex gap-4 pt-4">
        <button
          type="submit"
          disabled={busy}
          className="bg-primary/10 border border-primary/30 text-primary px-8 py-3 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg disabled:opacity-40"
        >
          {busy ? "Inscribing…" : "Consecrate"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin")}
          className="border border-primary/10 px-8 py-3 font-label tracking-widest uppercase text-[10px] text-gray-500 hover:text-primary hover:border-primary/30 transition-all rounded-lg"
        >
          Withdraw
        </button>
      </div>
    </form>
  );
}
