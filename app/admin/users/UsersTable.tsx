"use client";

import Link from "next/link";
import { useState } from "react";

type Row = {
  id: string;
  name: string;
  gender: string | null;
  level: number;
  token: string;
  createdAt: string;
};

export default function UsersTable({ users: initial, meId }: { users: Row[]; meId: string }) {
  const [users, setUsers] = useState(initial);

  async function onDelete(id: string, name: string) {
    if (!confirm(`Remove ${name}?`)) return;
    const r = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Delete failed: ${j.error ?? r.statusText}`);
      return;
    }
    setUsers((us) => us.filter((u) => u.id !== id));
  }

  return (
    <div className="mt-10 border border-primary/10 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] font-label uppercase tracking-[0.3em] text-primary/60 bg-surface-container-low">
          <tr>
            <th className="px-5 py-4">Name</th>
            <th className="px-5 py-4">Gender</th>
            <th className="px-5 py-4">Level</th>
            <th className="px-5 py-4">Token</th>
            <th className="px-5 py-4">Joined</th>
            <th className="px-5 py-4" />
          </tr>
        </thead>
        <tbody className="divide-y divide-primary/10">
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-primary/5 transition-colors">
              <td className="px-5 py-4 font-headline text-on-surface">
                {u.name}
                {u.id === meId ? (
                  <span className="ml-2 text-[9px] font-label uppercase tracking-[0.3em] text-secondary">
                    you
                  </span>
                ) : null}
              </td>
              <td className="px-5 py-4 text-on-surface-variant">{u.gender ?? "—"}</td>
              <td className="px-5 py-4 font-label text-[10px] tracking-[0.3em] uppercase text-primary/80">
                {u.level >= 100 ? `Priestess (${u.level})` : `Acolyte (${u.level})`}
              </td>
              <td className="px-5 py-4 font-mono text-xs text-on-surface-variant">{u.token}</td>
              <td className="px-5 py-4 text-on-surface-variant text-xs">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
              <td className="px-5 py-4 text-right font-label text-[10px] uppercase tracking-[0.2em]">
                <Link
                  href={`/admin/users/${u.id}/edit`}
                  className="text-primary/70 hover:text-primary"
                >
                  edit
                </Link>
                {u.id === meId ? null : (
                  <button
                    onClick={() => onDelete(u.id, u.name)}
                    className="ml-5 text-red-400 hover:text-red-300"
                  >
                    remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
