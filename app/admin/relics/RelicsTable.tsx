"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import RelicForm, { type RelicEditValue } from "./RelicForm";

type Row = {
  id: string;
  slot: number;
  slug: string;
  nameEn: string;
  nameZh: string;
  rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPECIAL";
  hasModel: boolean;
  hasPassword: boolean;
};

export default function RelicsTable({ rows }: { rows: Row[] }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<Row | "new" | null>(null);

  async function onDelete(row: Row) {
    if (!confirm(format(t.adminRelics.confirmRemove, { name: row.nameEn }))) return;
    const res = await fetch(`/api/relics/${row.id}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      alert(t.adminRelics.saveFailed);
    }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="px-4 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
        >
          {t.adminRelics.addNew}
        </button>
      </div>

      <div className="border border-primary/15 overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-surface-container/40 border-b border-primary/15">
            <tr className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
              <th className="px-4 py-3">{t.adminRelics.colSlot}</th>
              <th className="px-4 py-3">{t.adminRelics.colName}</th>
              <th className="px-4 py-3">{t.adminRelics.colRarity}</th>
              <th className="px-4 py-3">{t.adminRelics.colModel}</th>
              <th className="px-4 py-3">{t.adminRelics.colPassword}</th>
              <th className="px-4 py-3 text-right">{t.adminRelics.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant/60">
                  —
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-primary/10 hover:bg-primary/5">
                  <td className="px-4 py-3 font-label text-[11px] text-on-surface-variant">
                    {String(r.slot).padStart(3, "0")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-on-surface text-[14px]">{r.nameEn}</div>
                    <div className="text-on-surface-variant text-[12px]">{r.nameZh}</div>
                    <div className="font-label text-[10px] tracking-[0.2em] text-on-surface-variant/50 mt-0.5">{r.slug}</div>
                  </td>
                  <td className="px-4 py-3 font-label text-[11px] tracking-[0.2em] uppercase text-secondary">
                    {r.rarity}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-on-surface-variant">
                    {r.hasModel ? t.adminRelics.yes : t.adminRelics.no}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-on-surface-variant">
                    {r.hasPassword ? t.adminRelics.yes : t.adminRelics.no}
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="font-label text-[11px] tracking-[0.2em] uppercase text-primary hover:underline"
                    >
                      {t.adminRelics.edit}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(r)}
                      className="font-label text-[11px] tracking-[0.2em] uppercase text-error hover:underline"
                    >
                      {t.adminRelics.remove}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <RelicForm
          initial={editing === "new" ? null : (editing as RelicEditValue)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
