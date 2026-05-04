"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { EquipRow, SkillRow } from "../types";
import CyberPanel from "./CyberPanel";
import SkillPickerModal from "./SkillPickerModal";

type Props = {
  clericId: string;
  equips: EquipRow[];
  allSkills: SkillRow[];
  isAdmin: boolean;
};

const KIND_COLOR: Record<string, string> = {
  PASSIVE: "text-on-surface-variant border-on-surface-variant/30",
  ACTIVE: "text-primary border-primary/40",
  ULTIMATE: "text-secondary border-secondary/40",
};

export default function ClericSkillPanel({ clericId, equips, allSkills, isAdmin }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyUnlock, setBusyUnlock] = useState<string | null>(null);
  const [busyUnequip, setBusyUnequip] = useState<string | null>(null);

  async function toggleUnlock(skillId: string, current: boolean) {
    setBusyUnlock(skillId);
    try {
      await fetch(`/api/clerics/${clericId}/skills/${skillId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlocked: !current }),
      });
      router.refresh();
    } catch (e) {
      console.error("[ClericSkillPanel] toggleUnlock failed", e);
    } finally {
      setBusyUnlock(null);
    }
  }

  async function unequip(skillId: string, skillName: string) {
    if (!confirm(format(t.aiClergy.skillDeleteConfirm, { name: skillName }))) return;
    setBusyUnequip(skillId);
    try {
      await fetch(`/api/clerics/${clericId}/skills/${skillId}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      console.error("[ClericSkillPanel] unequip failed", e);
    } finally {
      setBusyUnequip(null);
    }
  }

  const sorted = [...equips].sort((a, b) => a.skill.level - b.skill.level);

  return (
    <>
      <CyberPanel className="p-5" markers={["bl"]}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">
            {t.aiClergy.skillEquippedSkills}
          </h2>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="font-label text-[9px] tracking-[0.2em] uppercase text-primary/70 hover:text-primary transition-colors flex items-center gap-1 min-h-[32px]"
            >
              <span className="material-symbols-outlined text-[14px]">add_circle</span>
              {t.aiClergy.skillEquipFromLibrary}
            </button>
          )}
        </div>

        {sorted.length === 0 ? (
          <p className="text-on-surface-variant text-sm py-4 text-center">{t.aiClergy.skillEmptyEquipped}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((equip) => {
              const skill = equip.skill;
              const name = locale === "zh" ? skill.nameZh : skill.nameEn;
              return (
                <div
                  key={equip.id}
                  className="flex items-center gap-3 p-3 bg-surface-variant/20 rounded border border-primary/10"
                >
                  <span
                    className={`material-symbols-outlined text-[24px] shrink-0 ${equip.unlocked ? "text-primary" : "text-on-surface-variant/40"}`}
                    style={{ fontVariationSettings: equip.unlocked ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {skill.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-label text-[9px] tracking-[0.15em] text-on-surface-variant/60 uppercase">
                        {format(t.aiClergy.skillLevel, { n: skill.level })}
                      </span>
                      <span
                        className={`font-label text-[8px] tracking-[0.12em] uppercase border rounded-sm px-1 py-0.5 ${KIND_COLOR[skill.kind] ?? ""}`}
                      >
                        {skill.kind === "PASSIVE"
                          ? t.aiClergy.skillKindPassive
                          : skill.kind === "ACTIVE"
                            ? t.aiClergy.skillKindActive
                            : t.aiClergy.skillKindUltimate}
                      </span>
                      {equip.unlocked && (
                        <span className="font-label text-[8px] tracking-[0.12em] uppercase border border-primary/40 text-primary rounded-sm px-1 py-0.5">
                          {t.aiClergy.skillEquipped}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-on-surface truncate">{name}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={busyUnlock === skill.id}
                        onClick={() => toggleUnlock(skill.id, equip.unlocked)}
                        title={equip.unlocked ? t.aiClergy.skillLock : t.aiClergy.skillUnlock}
                        className="min-w-[36px] min-h-[36px] flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {equip.unlocked ? "lock_open" : "lock"}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busyUnequip === skill.id}
                        onClick={() => unequip(skill.id, name)}
                        title={t.aiClergy.skillUnequip}
                        className="min-w-[36px] min-h-[36px] flex items-center justify-center text-on-surface-variant hover:text-error transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">remove_circle</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CyberPanel>

      {pickerOpen && (
        <SkillPickerModal
          clericId={clericId}
          allSkills={allSkills}
          equips={equips}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
