"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type Row = {
  id: string;
  serialLabel: string;
  name: string;
  gender: string | null;
  level: number;
  token: string;
  createdAt: string;
};

export default function UsersTable({ users: initial, meId }: { users: Row[]; meId: string }) {
  const t = useT();
  const [users, setUsers] = useState(initial);
  const genderLabel = (g: string | null) => {
    if (!g) return t.gender.none;
    if (g === "female") return t.gender.female;
    if (g === "male") return t.gender.male;
    if (g === "other") return t.gender.other;
    return g;
  };

  async function onDelete(id: string, name: string) {
    if (!confirm(format(t.adminUsers.confirmRemove, { name }))) return;
    const r = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(format(t.adminUsers.deleteFailed, { error: j.error ?? r.statusText }));
      return;
    }
    setUsers((us) => us.filter((u) => u.id !== id));
  }

  return (
    <div className="mt-10 border border-primary/10 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] font-label uppercase tracking-[0.3em] text-primary/60 bg-surface-container-low">
          <tr>
            <th className="px-5 py-4">{t.adminUsers.colRecord}</th>
            <th className="px-5 py-4">{t.adminUsers.colName}</th>
            <th className="px-5 py-4">{t.adminUsers.colGender}</th>
            <th className="px-5 py-4">{t.adminUsers.colLevel}</th>
            <th className="px-5 py-4">{t.adminUsers.colToken}</th>
            <th className="px-5 py-4">{t.adminUsers.colJoined}</th>
            <th className="px-5 py-4" />
          </tr>
        </thead>
        <tbody className="divide-y divide-primary/10">
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-primary/5 transition-colors">
              <td className="px-5 py-4 font-mono text-xs text-secondary tracking-[0.18em]">
                {u.serialLabel}
              </td>
              <td className="px-5 py-4 font-headline text-on-surface">
                {u.name}
                {u.id === meId ? (
                  <span className="ml-2 text-[9px] font-label uppercase tracking-[0.3em] text-secondary">
                    {t.adminUsers.you}
                  </span>
                ) : null}
              </td>
              <td className="px-5 py-4 text-on-surface-variant">{genderLabel(u.gender)}</td>
              <td className="px-5 py-4 font-label text-[10px] tracking-[0.3em] uppercase text-primary/80">
                {u.level >= 100
                  ? format(t.adminUsers.priestessShort, { level: u.level })
                  : format(t.adminUsers.acolyteShort, { level: u.level })}
              </td>
              <td className="px-5 py-4 font-mono text-xs text-on-surface-variant">{u.token}</td>
              <td className="px-5 py-4 text-on-surface-variant text-xs">
                {u.createdAt.slice(0, 10)}
              </td>
              <td className="px-5 py-4 text-right font-label text-[10px] uppercase tracking-[0.2em]">
                <Link
                  href={`/admin/users/${u.id}/edit`}
                  className="text-primary/70 hover:text-primary"
                >
                  {t.adminUsers.edit}
                </Link>
                {u.id === meId ? null : (
                  <button
                    onClick={() => onDelete(u.id, u.name)}
                    className="ml-5 text-red-400 hover:text-red-300"
                  >
                    {t.adminUsers.remove}
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
