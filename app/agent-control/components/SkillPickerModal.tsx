"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { SkillRow, EquipRow, AgentMode } from "../types";

type Props = {
  agentId: string;
  allSkills: SkillRow[];
  equips: EquipRow[];
  targetSlotIndex?: number | null;
  mode?: AgentMode;
  onClose: () => void;
};

const KIND_COLOR: Record<string, string> = {
  PASSIVE: "text-on-surface-variant border-on-surface-variant/30",
  ACTIVE: "text-primary border-primary/40",
  ULTIMATE: "text-secondary border-secondary/40",
};

export default function SkillPickerModal({
  agentId,
  allSkills,
  equips,
  targetSlotIndex,
  mode,
  onClose,
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  // The skill currently in the target slot (if any) gets evicted server-side
  // when we equip a new one — show all skills so admins can swap.
  const targetEquip = useMemo(
    () => (typeof targetSlotIndex === "number" ? equips.find((e) => e.slotIndex === targetSlotIndex) ?? null : null),
    [equips, targetSlotIndex],
  );
  const equippedNonTargetIds = useMemo(
    () => new Set(equips.filter((e) => e.id !== targetEquip?.id).map((e) => e.skillId)),
    [equips, targetEquip],
  );
  const available = useMemo(
    () => allSkills.filter((s) => !equippedNonTargetIds.has(s.id)),
    [allSkills, equippedNonTargetIds],
  );

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

  async function equip(skillId: string) {
    setBusy(skillId);
    try {
      const r = await fetch(`/api/agents/${agentId}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId,
          unlocked: false,
          slotIndex: typeof targetSlotIndex === "number" ? targetSlotIndex : undefined,
        }),
      });
      if (r.ok) {
        router.refresh();
        onClose();
      }
    } catch (e) {
      console.error("[SkillPickerModal] equip failed", e);
    } finally {
      setBusy(null);
    }
  }

  const accentClass = mode === "MECHANICAL" ? "text-secondary" : "text-primary";
  const slotLabel =
    typeof targetSlotIndex === "number"
      ? format(t.machineAgent.skillSlotLabel, { n: targetSlotIndex + 1 })
      : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.machineAgent.skillEquipFromLibrary}
      className="fixed inset-0 z-[110] flex items-stretch justify-center bg-black/85 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl my-auto p-4">
        <div className="cyber-panel rounded-lg p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`font-label text-[11px] tracking-[0.3em] uppercase ${accentClass}`}>
                {t.machineAgent.skillEquipFromLibrary}
              </h2>
              {slotLabel ? (
                <p className="font-label text-[9px] tracking-[0.25em] text-on-surface-variant uppercase mt-1">{slotLabel}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {available.length === 0 ? (
            <p className="text-on-surface-variant text-sm py-6 text-center">{t.machineAgent.skillEmptyLibrary}</p>
          ) : (
            <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
              {available.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center gap-4 p-3 bg-surface-variant/20 rounded border border-primary/10 hover:border-primary/30 transition-colors"
                >
                  <span
                    className="material-symbols-outlined text-[28px] text-primary/70 shrink-0"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {skill.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-label text-[9px] tracking-[0.2em] text-on-surface-variant/60 uppercase">
                        {format(t.machineAgent.skillLevel, { n: skill.level })}
                      </span>
                      <span
                        className={`font-label text-[9px] tracking-[0.15em] uppercase border rounded-sm px-1.5 py-0.5 ${KIND_COLOR[skill.kind] ?? ""}`}
                      >
                        {t.machineAgent[`skillKind${skill.kind[0]}${skill.kind.slice(1).toLowerCase()}` as keyof typeof t.machineAgent]}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface font-medium truncate">
                      {locale === "zh" ? skill.nameZh : skill.nameEn}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy === skill.id}
                    onClick={() => equip(skill.id)}
                    className="cyber-btn font-label text-[9px] tracking-[0.2em] uppercase min-h-[36px] px-4 shrink-0"
                  >
                    {busy === skill.id ? "…" : t.machineAgent.skillEquip}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    portal,
  );
}
