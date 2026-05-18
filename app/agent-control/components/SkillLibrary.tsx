"use client";

import { useMemo, useState } from "react";
import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { SkillRow, EquipRow, AgentRow } from "../types";
import SkillEditor from "./SkillEditor";
import TestInvokeDialog from "./TestInvokeDialog";
import SkillBook from "./skill-book/SkillBook";
import { buildSkillBookLayout } from "@/lib/agentControl/skillBookEntries";

type Props = {
  skills: SkillRow[];
  equipsByAgentId: Record<string, EquipRow[]>;
  // Reserved — Skill Library is a site-wide view, not bound to a single agent.
  activeAgentId: string | null;
  agents: AgentRow[];
  isAdmin: boolean;
};

type EditorState = { open: boolean; mode: "create" | "edit"; initial: SkillRow | null };

export default function SkillLibrary({ skills, equipsByAgentId, agents, isAdmin }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [editor, setEditor] = useState<EditorState>({ open: false, mode: "create", initial: null });
  const [testTarget, setTestTarget] = useState<SkillRow | null>(null);
  const [leftPageIndex, setLeftPageIndex] = useState(0);

  const layout = useMemo(() => buildSkillBookLayout(skills, isAdmin), [skills, isAdmin]);
  const { sortedSkills, entries, entryIndexBySkillId, createEntryIndex } = layout;

  // Group sorted skills by level for the TOC.
  const tocGroups = useMemo(() => {
    const map = new Map<number, SkillRow[]>();
    for (const s of sortedSkills) {
      const arr = map.get(s.level) ?? [];
      arr.push(s);
      map.set(s.level, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [sortedSkills]);

  const lastLeftIndex = Math.max(0, entries.length - 1);
  const safeLeftIndex = Math.min(Math.max(0, leftPageIndex), lastLeftIndex);

  // Single-select TOC highlight: only the entry at the LEFT page is active.
  // Right page is shown but not highlighted in TOC.
  const leftEntry = entries[safeLeftIndex];
  const activeSkillId =
    leftEntry && leftEntry.kind === "skill" ? leftEntry.skill.id : null;

  return (
    <div className="h-full overflow-hidden flex flex-col gap-3 p-4 md:p-5">
      {/* Top toolbar — title + admin entry. */}
      <div className="flex items-center justify-between flex-wrap gap-3 shrink-0">
        <h1 className="font-label text-[13px] tracking-[0.3em] text-primary uppercase">
          {t.agentControl.skillLibraryTitle}
        </h1>
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              if (createEntryIndex !== null) setLeftPageIndex(createEntryIndex);
              setEditor({ open: true, mode: "create", initial: null });
            }}
            className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[40px] px-4 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {t.agentControl.skillCreateNew}
          </button>
        )}
      </div>

      {/* Body: TOC sidebar + book */}
      <div className="flex-1 min-h-0 flex gap-4">
        <aside
          className="hidden md:flex flex-col w-[200px] shrink-0 border border-secondary/25 rounded bg-surface-variant/20 overflow-hidden"
          aria-label={t.agentControl.skillBookToc}
        >
          <div className="px-3 py-2 border-b border-secondary/20 shrink-0">
            <h2 className="font-label text-[10px] tracking-[0.3em] text-secondary/85 uppercase">
              {t.agentControl.skillBookToc}
            </h2>
          </div>
          <nav className="flex-1 min-h-0 overflow-y-auto py-2">
            {tocGroups.map(([level, group]) => (
              <div key={level} className="mb-3">
                <p className="px-3 mb-1 font-label text-[9px] tracking-[0.3em] text-secondary/55 uppercase">
                  {format(t.agentControl.skillBookTocLevel, { lv: level })}
                </p>
                <ul>
                  {group.map((skill) => {
                    const target = entryIndexBySkillId.get(skill.id);
                    const isActive = skill.id === activeSkillId;
                    const isOffline = skill.status === "OFFLINE";
                    const name = locale === "zh" ? skill.nameZh : skill.nameEn;
                    return (
                      <li key={skill.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (target !== undefined) setLeftPageIndex(target);
                          }}
                          className={[
                            "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors border-l-2",
                            isActive
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-transparent text-on-surface-variant/80 hover:bg-secondary/5 hover:text-on-surface hover:border-secondary/40",
                            isOffline ? "opacity-60" : "",
                          ].join(" ")}
                          title={skill.slug ?? skill.nameEn}
                        >
                          <span
                            className={[
                              "material-symbols-outlined text-[14px] shrink-0",
                              isActive ? "text-primary" : "text-secondary/70",
                            ].join(" ")}
                            style={{ fontVariationSettings: "'FILL' 1" }}
                            aria-hidden
                          >
                            {skill.icon || "auto_awesome"}
                          </span>
                          <span className="text-[11px] truncate flex-1">{name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 min-h-0">
          <SkillBook
            entries={entries}
            equipsByAgentId={equipsByAgentId}
            agents={agents}
            isAdmin={isAdmin}
            leftPageIndex={safeLeftIndex}
            onChangeLeftIndex={setLeftPageIndex}
            onTest={(s) => setTestTarget(s)}
            onEdit={(s) => {
              const target = entryIndexBySkillId.get(s.id);
              if (target !== undefined) setLeftPageIndex(target);
              setEditor({ open: true, mode: "edit", initial: s });
            }}
            onCreate={() => setEditor({ open: true, mode: "create", initial: null })}
          />
        </div>
      </div>

      {editor.open && (
        <SkillEditor
          mode={editor.mode}
          initial={editor.initial}
          equipsByAgentId={equipsByAgentId}
          agents={agents}
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
