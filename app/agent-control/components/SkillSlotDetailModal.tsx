"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { EquipRow, AgentMode } from "../types";
import { themeClass } from "@/lib/agentControl/theme";

type Props = {
  agentId: string;
  equip: EquipRow;
  mode: AgentMode;
  onClose: () => void;
};

export default function SkillSlotDetailModal({ agentId, equip, mode, onClose }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const portal = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);
  if (!portal) return null;

  async function unequip() {
    setBusy(true);
    try {
      const r = await fetch(`/api/agents/${agentId}/skills/${equip.skillId}`, { method: "DELETE" });
      if (r.ok) {
        router.refresh();
        onClose();
      }
    } catch (e) {
      console.error("[SkillSlotDetail] unequip failed", e);
    } finally {
      setBusy(false);
    }
  }

  const accent = themeClass(mode, "text");
  const skill = equip.skill;
  const slotLabel = typeof equip.slotIndex === "number" ? format(t.agentControl.skillSlotLabel, { n: equip.slotIndex + 1 }) : "";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.agentControl.skillSlotDetailTitle}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cyber-panel rounded-lg p-5 w-full max-w-md mx-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-label text-[10px] tracking-[0.3em] uppercase ${accent}`}>{slotLabel} · {t.agentControl.skillSlotDetailTitle}</p>
            <h3 className="mt-1 font-headline text-2xl text-on-surface sacred-glow">{locale === "zh" ? skill.nameZh : skill.nameEn}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface"
            aria-label={t.agentControl.cancel}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex items-center gap-3 text-[10px] font-label tracking-[0.2em] uppercase text-on-surface-variant">
          <span>{format(t.agentControl.skillLevel, { n: skill.level })}</span>
          <span>·</span>
          <span>{skill.kind === "HTTP_API" ? "HTTP" : skill.kind === "LLM_PROMPT" ? "LLM" : "MCP"}</span>
          <span>·</span>
          <span>{format(t.agentControl.skillCostAp, { n: skill.costAp })}</span>
        </div>

        <p className="text-sm text-on-surface-variant whitespace-pre-line">
          {locale === "zh" ? skill.descriptionZh : skill.descriptionEn}
        </p>

        <div className="flex gap-2 pt-2 border-t border-outline-variant/30">
          <button
            type="button"
            onClick={unequip}
            disabled={busy}
            className="flex-1 min-h-[44px] px-4 border border-rose-400/40 text-rose-300 font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-rose-400/10 transition-colors disabled:opacity-40"
          >
            {busy ? "…" : t.agentControl.skillSlotDetailUnequip}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-6 border border-outline-variant text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-surface-container transition-colors"
          >
            {t.agentControl.cancel}
          </button>
        </div>
      </div>
    </div>,
    portal,
  );
}
