"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n, useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/types";
import type { AgentRow } from "./types";
import type { CapabilitySummary } from "@/lib/agents/capabilityTypes";
import CyberPanel from "./components/CyberPanel";
import AgentListItem from "./components/AgentListItem";
import HologramCard from "./components/HologramCard";
import BaseStatsBar from "./components/BaseStatsBar";
import SkillProgressionRail from "./components/SkillProgressionRail";
import CapabilityList from "./components/CapabilityList";
import AgentEditor from "./components/AgentEditor";
import InvocationConsole from "./components/InvocationConsole";

type EditorState = { open: boolean; mode: "create" | "edit"; initial: AgentRow | null };

/**
 * Owns the `activeCapId` state shared between the rail and the list. Pulled out
 * so the parent can `key` it on the agent id — switching agents remounts this
 * subtree and the lazy useState initialiser picks the new default cleanly,
 * avoiding setState-in-effect.
 */
function CapabilityPair({
  capabilities,
  emptyText,
  skillProgressionLabel,
  locale,
  isAdmin,
}: {
  capabilities: CapabilitySummary[];
  emptyText: string;
  skillProgressionLabel: string;
  locale: Locale;
  isAdmin: boolean;
}) {
  const [activeCapId, setActiveCapId] = useState<string | null>(() => {
    if (capabilities.length === 0) return null;
    const firstReady = capabilities.find((c) => c.envOk);
    return (firstReady ?? capabilities[0]).id;
  });

  return (
    <>
      <CyberPanel className="p-5" markers={["tr"]}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">
            {skillProgressionLabel}
          </h2>
        </div>
        {capabilities.length === 0 ? (
          <p className="text-on-surface-variant text-sm py-6 text-center">{emptyText}</p>
        ) : (
          <SkillProgressionRail
            summaries={capabilities}
            activeId={activeCapId}
            onSelect={setActiveCapId}
          />
        )}
      </CyberPanel>

      <CyberPanel className="p-5" markers={["br"]} accent>
        <CapabilityList
          summaries={capabilities}
          locale={locale}
          activeId={activeCapId}
          onSelect={setActiveCapId}
          isAdmin={isAdmin}
        />
      </CyberPanel>
    </>
  );
}

export default function AgentClient({
  agents,
  isAdmin,
  capabilitiesByCodename,
}: {
  agents: AgentRow[];
  isAdmin: boolean;
  capabilitiesByCodename: Record<string, CapabilitySummary[]>;
}) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(agents[0]?.id ?? null);
  const [editor, setEditor] = useState<EditorState>({ open: false, mode: "create", initial: null });

  const activeAgent = useMemo(
    () => (activeId ? agents.find((a) => a.id === activeId) ?? null : null),
    [agents, activeId],
  );

  const activeCapabilities: CapabilitySummary[] = useMemo(
    () => (activeAgent ? capabilitiesByCodename[activeAgent.codename] ?? [] : []),
    [activeAgent, capabilitiesByCodename],
  );

  function openCreate() {
    setEditor({ open: true, mode: "create", initial: null });
  }
  function onSaved() {
    router.refresh();
  }

  return (
    <main className="flex-1 flex flex-col w-full max-w-[1440px] mx-auto px-4 md:px-8 py-5 md:py-7 gap-5">
      <div>
        <span className="font-label text-[10px] tracking-[0.4em] text-secondary uppercase">
          {t.machineVision.pageLabel}
        </span>
        <h1 className="mt-1 font-headline text-3xl md:text-4xl text-primary sacred-glow leading-tight">
          {t.machineVision.pageTitle}
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <CyberPanel className="lg:col-span-3 p-4 flex flex-col min-h-[420px]" markers={["tl", "br"]}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">
              {t.machineVision.agentCluster}
            </h2>
            <span className="material-symbols-outlined text-outline" aria-hidden>
              hub
            </span>
          </div>
          {agents.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-on-surface-variant text-sm">
              {t.machineVision.emptyState}
            </div>
          ) : (
            <div className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1">
              {agents.map((a) => (
                <AgentListItem key={a.id} agent={a} active={a.id === activeId} onSelect={setActiveId} />
              ))}
            </div>
          )}
          {isAdmin ? (
            <button
              type="button"
              onClick={openCreate}
              className="mt-3 min-h-[48px] w-full rounded-md border border-dashed border-primary/40 bg-primary/[0.04] hover:bg-primary/[0.12] text-primary font-label text-[10px] tracking-[0.3em] uppercase transition-colors flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base" aria-hidden>
                add_circle
              </span>
              {t.machineVision.unlockAgent}
            </button>
          ) : null}
        </CyberPanel>

        <CyberPanel className="lg:col-span-4 p-5" markers={["tl", "br"]}>
          {activeAgent ? (
            <div className="flex flex-col gap-5 h-full">
              <HologramCard agent={activeAgent} />
              <div className="border-t border-outline-variant/30 pt-4">
                <BaseStatsBar agent={activeAgent} />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-on-surface-variant text-sm">
              {t.machineVision.noAgentSelected}
            </div>
          )}
        </CyberPanel>

        <div className="lg:col-span-5 flex flex-col gap-4">
          <CapabilityPair
            key={activeAgent?.id ?? "no-agent"}
            capabilities={activeCapabilities}
            emptyText={t.machineVision.capabilityEmpty}
            skillProgressionLabel={t.machineVision.skillProgression}
            locale={locale}
            isAdmin={isAdmin}
          />

          {activeAgent ? (
            <CyberPanel className="p-5" markers={["bl"]}>
              <InvocationConsole key={activeAgent.id} agent={activeAgent} isAdmin={isAdmin} />
            </CyberPanel>
          ) : null}
        </div>
      </div>

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
