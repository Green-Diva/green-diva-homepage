"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

type Project = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  published: boolean;
  order: number;
};

const TOKEN_KEY = "admin_token";

function subscribeToTokenStore(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getClientTokenSnapshot() {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

function getServerTokenSnapshot() {
  return "";
}

export default function AdminHome() {
  const token = useSyncExternalStore(
    subscribeToTokenStore,
    getClientTokenSnapshot,
    getServerTokenSnapshot,
  );
  const [input, setInput] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch("/api/projects?all=1", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      })
      .then((data) => {
        setProjects(data);
        setErr(null);
      })
      .catch((e) => {
        setErr(String(e.message ?? e));
        setProjects(null);
      });
  }, [token]);

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-8">
        <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
          Sanctum Entrance
        </span>
        <h1 className="mt-3 font-headline text-4xl font-light text-primary sacred-glow">
          Priestess Sign-in
        </h1>
        <p className="mt-4 text-sm text-on-surface-variant font-light">
          Offer your <code className="text-secondary">ADMIN_TOKEN</code> to the vault.
          It will be kept in local storage, not transmitted elsewhere.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            localStorage.setItem(TOKEN_KEY, input);
            window.dispatchEvent(new StorageEvent("storage", { key: TOKEN_KEY }));
          }}
          className="mt-8 flex gap-2"
        >
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ADMIN_TOKEN"
            className="flex-1 bg-surface-container border border-primary/20 px-3 py-2 text-sm text-on-surface focus:border-primary/50 focus:outline-none rounded-lg"
          />
          <button
            type="submit"
            className="bg-primary/10 border border-primary/30 text-primary px-5 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg"
          >
            Enter
          </button>
        </form>
      </main>
    );
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this project?")) return;
    const r = await fetch(`/api/projects/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      alert(`Delete failed: ${(await r.json()).error ?? r.statusText}`);
      return;
    }
    setProjects((ps) => ps?.filter((p) => p.id !== id) ?? null);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-12">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
            Archive 01
          </span>
          <h1 className="mt-2 font-headline text-4xl font-light text-primary sacred-glow">
            Chronicles
          </h1>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <Link
            href="/admin/projects/new"
            className="bg-primary/10 border border-primary/30 text-primary px-5 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg"
          >
            + Inscribe
          </Link>
          <Link
            href="/"
            className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/70 hover:text-primary transition-colors"
          >
            Sanctuary
          </Link>
          <button
            onClick={() => {
              localStorage.removeItem(TOKEN_KEY);
              window.dispatchEvent(new StorageEvent("storage", { key: TOKEN_KEY }));
            }}
            className="font-label text-[10px] tracking-[0.3em] uppercase text-gray-500 hover:text-primary transition-colors"
          >
            Depart
          </button>
        </div>
      </div>

      {err ? <p className="mt-6 text-sm text-red-400">{err}</p> : null}

      {projects ? (
        <div className="mt-10 border border-primary/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] font-label uppercase tracking-[0.3em] text-primary/60 bg-surface-container-low">
              <tr>
                <th className="px-5 py-4">Title</th>
                <th className="px-5 py-4">Slug</th>
                <th className="px-5 py-4">Order</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/10">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-primary/5 transition-colors">
                  <td className="px-5 py-4 font-headline text-on-surface">{p.title}</td>
                  <td className="px-5 py-4 font-mono text-xs text-on-surface-variant">{p.slug}</td>
                  <td className="px-5 py-4 text-on-surface-variant">{p.order}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`font-label text-[9px] uppercase tracking-[0.3em] ${p.published ? "text-primary" : "text-gray-500"
                        }`}
                    >
                      {p.published ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right font-label text-[10px] uppercase tracking-[0.2em]">
                    <Link
                      href={`/admin/projects/${p.id}/edit`}
                      className="text-primary/70 hover:text-primary"
                    >
                      edit
                    </Link>
                    <button
                      onClick={() => onDelete(p.id)}
                      className="ml-5 text-red-400 hover:text-red-300"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-10 text-sm text-on-surface-variant font-label tracking-[0.2em] uppercase">
          Consulting the vaults…
        </p>
      )}
    </main>
  );
}
