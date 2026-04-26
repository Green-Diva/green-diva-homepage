"use client";

import Link from "next/link";
import { useState } from "react";

type Project = {
  id: string;
  slug: string;
  title: string;
  published: boolean;
  order: number;
};

export default function AdminProjectsTable({
  projects: initial,
  canEdit,
}: {
  projects: Project[];
  canEdit: boolean;
}) {
  const [projects, setProjects] = useState(initial);

  async function onDelete(id: string) {
    if (!confirm("Delete this project?")) return;
    const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Delete failed: ${j.error ?? r.statusText}`);
      return;
    }
    setProjects((ps) => ps.filter((p) => p.id !== id));
  }

  return (
    <div className="mt-10 border border-primary/10 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] font-label uppercase tracking-[0.3em] text-primary/60 bg-surface-container-low">
          <tr>
            <th className="px-5 py-4">Title</th>
            <th className="px-5 py-4">Slug</th>
            <th className="px-5 py-4">Order</th>
            <th className="px-5 py-4">Status</th>
            {canEdit ? <th className="px-5 py-4" /> : null}
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
                  className={`font-label text-[9px] uppercase tracking-[0.3em] ${
                    p.published ? "text-primary" : "text-gray-500"
                  }`}
                >
                  {p.published ? "Published" : "Draft"}
                </span>
              </td>
              {canEdit ? (
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
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
