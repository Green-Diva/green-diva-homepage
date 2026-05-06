"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { AgentRow, SkillRow, EquipRow } from "./types";
import CyberPanel from "./components/CyberPanel";
import AgentListItem from "./components/AgentListItem";
import AgentEditor from "./components/AgentEditor";
import SkillLibrary from "./components/SkillLibrary";
import AgentFilterChips, { type ModeFilter } from "./components/AgentFilterChips";
import DetailHeader from "./components/DetailHeader";
import BaseStatsBar from "./components/BaseStatsBar";
import AgentHeroPortrait from "./components/AgentHeroPortrait";
import SkillsControlPanel from "./components/SkillsControlPanel";
import DeployButton from "./components/DeployButton";

type EditorState = { open: boolean; mode: "create" | "edit"; initial: AgentRow | null };
type TabKey = "agents" | "skills";

export default function AgentClient({
  agents,
  isAdmin,
  skills,
  equipsByAgentId,
}: {
  agents: AgentRow[];
  isAdmin: boolean;
  skills: SkillRow[];
  equipsByAgentId: Record<string, EquipRow[]>;
}) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [activeId, setActiveId] = useState<string | null>(agents[0]?.id ?? null);
  const [editor, setEditor] = useState<EditorState>({ open: false, mode: "create", initial: null });
  const [filter, setFilter] = useState<ModeFilter>("ALL");

  const activeTab: TabKey = searchParams.get("tab") === "skills" ? "skills" : "agents";

  function switchTab(tab: TabKey) {
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", tab);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  const counts = useMemo(
    () => ({
      all: agents.length,
      machines: agents.filter((a) => a.mode === "MECHANICAL").length,
      agents: agents.filter((a) => a.mode === "AUTONOMOUS").length,
    }),
    [agents],
  );

  const visibleAgents = useMemo(() => {
    if (filter === "ALL") return agents;
    return agents.filter((a) => a.mode === filter);
  }, [agents, filter]);

  const activeAgent = useMemo(
    () => (activeId ? agents.find((a) => a.id === activeId) ?? null : null),
    [agents, activeId],
  );

  const activeEquips: EquipRow[] = useMemo(
    () => (activeId ? (equipsByAgentId[activeId] ?? []) : []),
    [activeId, equipsByAgentId],
  );

  function openCreate() {
    setEditor({ open: true, mode: "create", initial: null });
  }
  function openEdit() {
    if (!activeAgent) return;
    setEditor({ open: true, mode: "edit", initial: activeAgent });
  }
  function onSaved() {
    router.refresh();
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col w-full max-w-[1440px] mx-auto px-4 lg:px-8 py-3 gap-3 lg:overflow-hidden">
      <div className="shrink-0 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 self-end border-b border-primary/20">
          {(["agents", "skills"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => switchTab(tab)}
              className={[
                "min-h-[40px] px-5 font-label text-[10px] tracking-[0.3em] uppercase transition-colors border-b-2",
                activeTab === tab
                  ? "text-primary border-primary"
                  : "text-on-surface-variant border-transparent hover:text-primary/70",
              ].join(" ")}
            >
              {tab === "agents" ? t.machineAgent.tabAgents : t.machineAgent.tabSkillLibrary}
            </button>
          ))}
        </div>
        {activeTab === "agents" ? (
          <AgentFilterChips value={filter} onChange={setFilter} counts={counts} />
        ) : null}
      </div>

      {activeTab === "skills" ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SkillLibrary
            skills={skills}
            equipsByAgentId={equipsByAgentId}
            activeAgentId={activeId}
            isAdmin={isAdmin}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: roster (lg:3) */}
          <CyberPanel className="lg:col-span-3 p-3 min-h-0" markers={["tl", "br"]}>
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <h2 className="font-label text-[10px] tracking-[0.3em] text-primary uppercase">
                  {t.machineAgent.agentRoster}
                </h2>
                <span className="material-symbols-outlined text-outline" aria-hidden>
                  hub
                </span>
              </div>
              {visibleAgents.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-on-surface-variant text-sm">
                  {t.machineAgent.emptyState}
                </div>
              ) : (
                <div className="flex-1 min-h-0 space-y-2 overflow-y-auto custom-scrollbar pr-1">
                  {visibleAgents.map((a) => (
                    <AgentListItem key={a.id} agent={a} active={a.id === activeId} onSelect={setActiveId} />
                  ))}
                </div>
              )}
              {isAdmin ? (
                <button
                  type="button"
                  onClick={openCreate}
                  className="mt-2 shrink-0 min-h-[44px] w-full rounded-md border border-dashed border-primary/40 bg-primary/[0.04] hover:bg-primary/[0.12] text-primary font-label text-[10px] tracking-[0.3em] uppercase transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-base" aria-hidden>
                    add_circle
                  </span>
                  {t.machineAgent.ordainAgent}
                </button>
              ) : null}
            </div>
          </CyberPanel>

          {/* Right: detail (lg:9). Header row + BaseStats + 3 equal-height columns. */}
          <CyberPanel className="lg:col-span-9 p-4 min-h-0 overflow-hidden" markers={["tl", "br"]}>
            {activeAgent ? (
              <div className="flex flex-col h-full gap-3 min-h-0">
                <div className="flex items-start justify-between gap-3 shrink-0">
                  <DetailHeader agent={activeAgent} isAdmin={isAdmin} onEdit={openEdit} />
                  <DeployButton agent={activeAgent} isAdmin={isAdmin} />
                </div>
                <BaseStatsBar agent={activeAgent} />
                <div className="flex-1 min-h-0 grid grid-cols-[calc((100%+48px)/4)_minmax(0,1fr)] gap-x-4 items-stretch">
                  <AgentHeroPortrait agent={activeAgent} />
                  <div className="min-h-0">
                    <SkillsControlPanel
                      key={`scp-${activeAgent.id}`}
                      agent={activeAgent}
                      equips={activeEquips}
                      allSkills={skills}
                      isAdmin={isAdmin}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-on-surface-variant text-sm">
                {t.machineAgent.noAgentSelected}
              </div>
            )}
          </CyberPanel>
        </div>
      )}

      {editor.open ? (
        <AgentEditor
          key={editor.initial?.id ?? "new"}
          mode={editor.mode}
          initial={editor.initial}
          onClose={() => setEditor((s) => ({ ...s, open: false }))}
          onSaved={onSaved}
        />
      ) : null}
    </main>
  );
}
