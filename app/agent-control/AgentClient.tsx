"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useT } from "@/lib/i18n/client";
import type {
  AgentRow,
  SkillRow,
  EquipRow,
  SceneBindingRow,
  SerializableSceneDef,
  AgentPickerOption,
} from "./types";
import CyberPanel from "./components/CyberPanel";
import AgentListItem from "./components/AgentListItem";
import SortableAgentListItem from "./components/SortableAgentListItem";
import AgentEditor from "./components/AgentEditor";
import AgentImportModal from "./components/AgentImportModal";
import SkillLibrary from "./components/SkillLibrary";
import ScenesPanel from "./components/ScenesPanel";
import AgentFilterChips, { type ModeFilter } from "./components/AgentFilterChips";
import MechanicalDetailView from "./components/MechanicalDetailView";
import AutonomousDetailView from "./components/AutonomousDetailView";
import AgentJobDrawer from "./components/AgentJobDrawer";

type EditorState = { open: boolean; mode: "create" | "edit"; initial: AgentRow | null };
type TabKey = "agents" | "skills" | "scenes";

const TAB_KEYS = ["agents", "skills", "scenes"] as const satisfies readonly TabKey[];

function tabFromQuery(value: string | null): TabKey {
  return TAB_KEYS.includes(value as TabKey) ? (value as TabKey) : "agents";
}

export default function AgentClient({
  agents,
  isAdmin,
  skills,
  equipsByAgentId,
  sceneBindings,
  sceneDefs,
  agentOptions,
}: {
  agents: AgentRow[];
  isAdmin: boolean;
  skills: SkillRow[];
  equipsByAgentId: Record<string, EquipRow[]>;
  sceneBindings: SceneBindingRow[];
  sceneDefs: SerializableSceneDef[];
  agentOptions: AgentPickerOption[];
}) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [activeId, setActiveId] = useState<string | null>(agents[0]?.id ?? null);
  const [editor, setEditor] = useState<EditorState>({ open: false, mode: "create", initial: null });
  const [filter, setFilter] = useState<ModeFilter>("ALL");
  const [jobsOpen, setJobsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Mount DndContext only after hydration. dnd-kit's auto-generated
  // aria-describedby ids come from a module-level counter that diverges
  // between server and client, causing a hydration mismatch warning.
  // Rendering the plain list during SSR and swapping to the sortable
  // version post-mount avoids the warning entirely.
  const [dndMounted, setDndMounted] = useState(false);
  useEffect(() => {
    setDndMounted(true);
  }, []);
  // Local mirror of agents so drag-reorder can update optimistically. Resync
  // whenever the server prop changes (router.refresh after save/import/etc.)
  // using React's "adjust state during render" pattern (avoids useEffect).
  const [orderedAgents, setOrderedAgents] = useState<AgentRow[]>(agents);
  const [prevAgentsRef, setPrevAgentsRef] = useState(agents);
  if (prevAgentsRef !== agents) {
    setPrevAgentsRef(agents);
    setOrderedAgents(agents);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const prev = orderedAgents;
    // Reorder within the currently-visible subset (mode filter may hide rows).
    const visibleIds = orderedAgents.filter((a) => filter === "ALL" || a.mode === filter).map((a) => a.id);
    const fromVisible = visibleIds.indexOf(String(active.id));
    const toVisible = visibleIds.indexOf(String(over.id));
    if (fromVisible < 0 || toVisible < 0) return;
    const nextVisible = arrayMove(visibleIds, fromVisible, toVisible);
    // Merge back into full list: walk full list; whenever we hit a visible
    // position, take the next id from nextVisible.
    let cursor = 0;
    const nextFull = orderedAgents.map((a) => {
      const inVisible = filter === "ALL" || a.mode === filter;
      if (!inVisible) return a;
      const id = nextVisible[cursor++];
      return orderedAgents.find((x) => x.id === id)!;
    });
    setOrderedAgents(nextFull);
    try {
      const res = await fetch("/api/agents/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: nextFull.map((a) => a.id) }),
      });
      if (!res.ok) throw new Error("reorder failed");
      router.refresh();
    } catch {
      setOrderedAgents(prev);
    }
  }

  const activeTab: TabKey = tabFromQuery(searchParams.get("tab"));

  function switchTab(tab: TabKey) {
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", tab);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  function tabLabel(tab: TabKey): string {
    if (tab === "agents") return t.agentControl.tabAgents;
    if (tab === "skills") return t.agentControl.tabSkillLibrary;
    return t.agentControl.tabScenes;
  }

  const counts = useMemo(
    () => ({
      all: orderedAgents.length,
      machines: orderedAgents.filter((a) => a.mode === "MECHANICAL").length,
      agents: orderedAgents.filter((a) => a.mode === "AUTONOMOUS").length,
    }),
    [orderedAgents],
  );

  const visibleAgents = useMemo(() => {
    if (filter === "ALL") return orderedAgents;
    return orderedAgents.filter((a) => a.mode === filter);
  }, [orderedAgents, filter]);

  const activeAgent = useMemo(
    () => (activeId ? orderedAgents.find((a) => a.id === activeId) ?? null : null),
    [orderedAgents, activeId],
  );

  // After a remove (or any external refresh that drops the row), the
  // activeId can dangle. Auto-snap to the first remaining roster entry so
  // admin sees the next agent instead of the empty "Pick an agent" state.
  useEffect(() => {
    if (activeId && !orderedAgents.find((a) => a.id === activeId)) {
      setActiveId(orderedAgents[0]?.id ?? null);
    }
  }, [orderedAgents, activeId]);

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

  // "Save in Tune Agent with STATUS = DEPLOYED" should drop into the
  // normal Deploy confirm flow. AgentEditor strips the status field from
  // its PATCH (server stays STANDBY), then calls this to nudge the
  // DeployButton's confirm modal open. We key by Date.now() so the same
  // user picking DEPLOYED twice in a row still re-triggers the effect.
  const [autoDeploy, setAutoDeploy] = useState<{ agentId: string; nonce: number } | null>(null);
  function requestDeploy(agentId: string) {
    setAutoDeploy({ agentId, nonce: Date.now() });
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col w-full max-w-[1440px] mx-auto px-4 lg:px-8 py-3 gap-3 lg:overflow-hidden">
      <div className="shrink-0 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 self-end border-b border-primary/20">
          {TAB_KEYS.map((tab) => (
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
              {tabLabel(tab)}
            </button>
          ))}
        </div>
        {activeTab === "agents" ? (
          <AgentFilterChips value={filter} onChange={setFilter} counts={counts} />
        ) : null}
      </div>

      {activeTab === "scenes" ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ScenesPanel
            scenes={sceneDefs}
            bindings={sceneBindings}
            agents={agentOptions}
            isAdmin={isAdmin}
            onSaved={onSaved}
          />
        </div>
      ) : activeTab === "skills" ? (
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
                  {t.agentControl.agentRoster}
                </h2>
                <span className="material-symbols-outlined text-outline" aria-hidden>
                  hub
                </span>
              </div>
              {visibleAgents.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-on-surface-variant text-sm">
                  {t.agentControl.emptyState}
                </div>
              ) : (
                dndMounted ? (
                  <DndContext id="agent-roster-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={visibleAgents.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto custom-scrollbar pr-1">
                        {visibleAgents.map((a) => (
                          <SortableAgentListItem
                            key={a.id}
                            agent={a}
                            active={a.id === activeId}
                            onSelect={setActiveId}
                            draggable={isAdmin}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="flex-1 min-h-0 space-y-2 overflow-y-auto custom-scrollbar pr-1">
                    {visibleAgents.map((a) => (
                      <AgentListItem key={a.id} agent={a} active={a.id === activeId} onSelect={setActiveId} />
                    ))}
                  </div>
                )
              )}
              {isAdmin ? (
                <div className="mt-2 shrink-0 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={openCreate}
                    className="min-h-[44px] w-full rounded-md border border-dashed border-primary/40 bg-primary/[0.04] hover:bg-primary/[0.12] text-primary font-label text-[10px] tracking-[0.3em] uppercase transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden>
                      add_circle
                    </span>
                    {t.agentControl.ordainAgent}
                  </button>
                  {/* Phase 4: Export current / Import new — both rely on
                      the agent-export-v1 JSON envelope. Export only shows
                      when there's a selected agent to export. */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (activeId) window.open(`/api/agents/${activeId}/export`, "_blank");
                      }}
                      disabled={!activeId}
                      className="min-h-[36px] rounded-md border border-secondary/40 bg-secondary/[0.04] hover:bg-secondary/[0.12] text-secondary font-label text-[10px] tracking-[0.25em] uppercase transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden>
                        download
                      </span>
                      {t.agentControl.exportAgent}
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportOpen(true)}
                      className="min-h-[36px] rounded-md border border-secondary/40 bg-secondary/[0.04] hover:bg-secondary/[0.12] text-secondary font-label text-[10px] tracking-[0.25em] uppercase transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden>
                        upload
                      </span>
                      {t.agentControl.importAgent}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </CyberPanel>

          {/* Right: detail (lg:9). Header row + BaseStats + 3 equal-height columns. */}
          <CyberPanel className="lg:col-span-9 p-4 min-h-0 overflow-hidden" markers={["tl", "br"]}>
            {activeAgent ? (
              activeAgent.mode === "MECHANICAL" ? (
                <MechanicalDetailView
                  agent={activeAgent}
                  equips={activeEquips}
                  allSkills={skills}
                  isAdmin={isAdmin}
                  sceneDefs={sceneDefs}
                  sceneBindings={sceneBindings}
                  autoDeployNonce={autoDeploy?.agentId === activeAgent.id ? autoDeploy.nonce : null}
                  onEdit={openEdit}
                  onShowJobs={() => setJobsOpen(true)}
                />
              ) : (
                <AutonomousDetailView
                  agent={activeAgent}
                  equips={activeEquips}
                  allSkills={skills}
                  isAdmin={isAdmin}
                  sceneDefs={sceneDefs}
                  sceneBindings={sceneBindings}
                  autoDeployNonce={autoDeploy?.agentId === activeAgent.id ? autoDeploy.nonce : null}
                  onEdit={openEdit}
                  onShowJobs={() => setJobsOpen(true)}
                />
              )
            ) : (
              <div className="h-full flex items-center justify-center text-on-surface-variant text-sm">
                {t.agentControl.noAgentSelected}
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
          sceneDefs={sceneDefs}
          sceneBindings={sceneBindings}
          onClose={() => setEditor((s) => ({ ...s, open: false }))}
          onSaved={onSaved}
          onRequestDeploy={requestDeploy}
        />
      ) : null}

      {jobsOpen && activeAgent ? (
        <AgentJobDrawer
          key={`jobs-${activeAgent.id}`}
          agentId={activeAgent.id}
          agentCodename={activeAgent.codename}
          isAdmin={isAdmin}
          onClose={() => setJobsOpen(false)}
        />
      ) : null}

      {importOpen && isAdmin ? (
        <AgentImportModal
          onClose={() => setImportOpen(false)}
          onSaved={onSaved}
        />
      ) : null}
    </main>
  );
}
