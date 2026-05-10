"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { SkillRow, EquipRow, HandlerKind } from "../types";
import CyberPanel from "./CyberPanel";
import SkillEditor from "./SkillEditor";
import TestInvokeDialog from "./TestInvokeDialog";

type Props = {
  skills: SkillRow[];
  equipsByAgentId: Record<string, EquipRow[]>;
  activeAgentId: string | null;
  isAdmin: boolean;
};

type EditorState = { open: boolean; mode: "create" | "edit"; initial: SkillRow | null };

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

// Compact label per HandlerKind — chip in the card header. Same neutral
// palette across all three; the textual difference is enough to scan and
// avoids fighting the MECHANICAL/AUTONOMOUS mode colors.
const HANDLER_CHIP_LABEL: Record<HandlerKind, string> = {
  HTTP_API: "HTTP",
  LLM_PROMPT: "LLM",
  MCP_SERVER: "MCP",
};

export default function SkillLibrary({ skills, equipsByAgentId, activeAgentId, isAdmin }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [editor, setEditor] = useState<EditorState>({ open: false, mode: "create", initial: null });
  const [busyEquip, setBusyEquip] = useState<string | null>(null);
  const [equipError, setEquipError] = useState<string | null>(null);
  const [testTarget, setTestTarget] = useState<SkillRow | null>(null);

  const activeEquips = activeAgentId ? (equipsByAgentId[activeAgentId] ?? []) : [];
  const equippedIds = new Set(activeEquips.map((e) => e.skillId));

  async function toggleEquip(skill: SkillRow) {
    if (!activeAgentId) return;
    setBusyEquip(skill.id);
    setEquipError(null);
    const isEquipped = equippedIds.has(skill.id);
    try {
      const r = isEquipped
        ? await fetch(`/api/agents/${activeAgentId}/skills/${skill.id}`, { method: "DELETE" })
        : await fetch(`/api/agents/${activeAgentId}/skills`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skillId: skill.id, unlocked: false }),
          });
      if (!r.ok) {
        setEquipError(
          r.status === 409 ? t.agentControl.skillEquipCapacityFull : t.agentControl.skillEquipFailed
        );
        return;
      }
      router.refresh();
    } catch (e) {
      console.error("[SkillLibrary] toggleEquip failed", e);
      setEquipError(t.agentControl.skillEquipFailed);
    } finally {
      setBusyEquip(null);
    }
  }

  const byLevel = LEVELS.reduce<Record<number, SkillRow[]>>((acc, lv) => {
    acc[lv] = skills.filter((s) => s.level === lv);
    return acc;
  }, {} as Record<number, SkillRow[]>);

  return (
    <div className="flex-1 overflow-y-auto p-5 md:p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-label text-[13px] tracking-[0.3em] text-primary uppercase">
          {t.agentControl.skillLibraryTitle}
        </h1>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditor({ open: true, mode: "create", initial: null })}
            className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[44px] px-5 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {t.agentControl.skillCreateNew}
          </button>
        )}
      </div>

      {equipError && (
        <div
          role="alert"
          className="flex items-start gap-2 border border-error/40 bg-error/10 text-error rounded-sm px-3 py-2"
        >
          <span className="material-symbols-outlined text-[16px] mt-0.5">error</span>
          <p className="flex-1 font-label text-[11px] tracking-[0.1em] uppercase">{equipError}</p>
          <button
            type="button"
            onClick={() => setEquipError(null)}
            className="min-w-[24px] min-h-[24px] flex items-center justify-center text-error/70 hover:text-error"
            aria-label="dismiss"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {skills.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-on-surface-variant text-sm">{t.agentControl.skillEmptyLibrary}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {LEVELS.map((lv) => {
            const group = byLevel[lv];
            if (group.length === 0) return null;
            return (
              <div key={lv}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="font-label text-[10px] tracking-[0.3em] text-primary/60 uppercase">
                    {format(t.agentControl.skillLevel, { n: lv })}
                  </span>
                  <div className="flex-1 h-px bg-primary/15" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {group.map((skill) => {
                    const name = locale === "zh" ? skill.nameZh : skill.nameEn;
                    const desc = locale === "zh" ? skill.descriptionZh : skill.descriptionEn;
                    const isEquipped = equippedIds.has(skill.id);
                    const isOffline = skill.status === "OFFLINE";
                    return (
                      <CyberPanel
                        key={skill.id}
                        className={[
                          "p-4 flex flex-col gap-3 transition-opacity",
                          isOffline ? "opacity-55" : "",
                        ].join(" ")}
                        markers={["tl"]}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={[
                              "material-symbols-outlined text-[32px]",
                              isOffline ? "text-on-surface-variant/50" : "text-primary/70",
                            ].join(" ")}
                            style={{ fontVariationSettings: "'FILL' 1" }}
                          >
                            {skill.icon}
                          </span>
                          <div className="flex gap-0.5 shrink-0">
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setTestTarget(skill)}
                                  className="min-w-[32px] min-h-[32px] flex items-center justify-center text-on-surface-variant/50 hover:text-primary transition-colors"
                                  title={t.agentControl.skillTestInvokeTitle}
                                  aria-label={t.agentControl.skillTestInvokeTitle}
                                >
                                  <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditor({ open: true, mode: "edit", initial: skill })}
                                  className="min-w-[32px] min-h-[32px] flex items-center justify-center text-on-surface-variant/50 hover:text-primary transition-colors"
                                  title={t.agentControl.skillEdit}
                                  aria-label={t.agentControl.skillEdit}
                                >
                                  <span className="material-symbols-outlined text-[16px]">edit</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={[
                              "font-label text-[8px] tracking-[0.15em] uppercase border rounded-sm px-1.5 py-0.5 font-mono",
                              "text-on-surface-variant/80 border-on-surface-variant/30",
                            ].join(" ")}
                            title="Handler type"
                          >
                            {HANDLER_CHIP_LABEL[skill.kind]}
                          </span>
                          <span
                            className={[
                              "font-label text-[8px] tracking-[0.15em] uppercase border rounded-sm px-1.5 py-0.5 inline-flex items-center gap-1",
                              isOffline
                                ? "border-error/40 text-error/80"
                                : "border-primary/40 text-primary/80",
                            ].join(" ")}
                          >
                            <span
                              aria-hidden
                              className={[
                                "inline-block w-1.5 h-1.5 rounded-full",
                                isOffline ? "bg-error/70" : "bg-primary/80 shadow-[0_0_4px_rgba(144,222,205,0.6)]",
                              ].join(" ")}
                            />
                            {isOffline
                              ? t.agentControl.skillStatusOffline
                              : t.agentControl.skillStatusOnline}
                          </span>
                          {isEquipped && (
                            <span className="font-label text-[8px] tracking-[0.12em] uppercase border border-primary/40 text-primary rounded-sm px-1 py-0.5">
                              {t.agentControl.skillEquipped}
                            </span>
                          )}
                        </div>

                        <div>
                          <p className="text-sm font-medium text-on-surface">{name}</p>
                          {skill.slug && (
                            <p className="font-mono text-[10px] text-on-surface-variant/50 mt-0.5 truncate">
                              {skill.slug}
                            </p>
                          )}
                          {desc && (
                            <p className="text-[11px] text-on-surface-variant/70 mt-1 line-clamp-2">{desc}</p>
                          )}
                        </div>

                        {activeAgentId && (
                          <div className="mt-auto pt-1">
                            <button
                              type="button"
                              disabled={busyEquip === skill.id}
                              onClick={() => toggleEquip(skill)}
                              className={[
                                "w-full font-label text-[9px] tracking-[0.2em] uppercase min-h-[34px] rounded border transition-colors",
                                isEquipped
                                  ? "border-error/30 text-error/70 hover:border-error/60 hover:text-error"
                                  : "border-primary/30 text-primary/70 hover:border-primary/60 hover:text-primary",
                              ].join(" ")}
                            >
                              {busyEquip === skill.id
                                ? "…"
                                : isEquipped
                                  ? t.agentControl.skillUnequip
                                  : t.agentControl.skillEquip}
                            </button>
                          </div>
                        )}
                      </CyberPanel>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor.open && (
        <SkillEditor
          mode={editor.mode}
          initial={editor.initial}
          onClose={() => setEditor({ open: false, mode: "create", initial: null })}
          onSaved={() => setEditor({ open: false, mode: "create", initial: null })}
        />
      )}

      {testTarget && (
        <TestInvokeDialog skill={testTarget} onClose={() => setTestTarget(null)} />
      )}
    </div>
  );
}
