"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useI18n, useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/types";
import type { ClericRow, SkillRow, EquipRow } from "./types";
import type { CapabilitySummary } from "@/lib/clerics/capabilityTypes";
import CyberPanel from "./components/CyberPanel";
import ClericListItem from "./components/ClericListItem";
import HologramCard from "./components/HologramCard";
import BaseStatsBar from "./components/BaseStatsBar";
import SkillProgressionRail from "./components/SkillProgressionRail";
import CapabilityList from "./components/CapabilityList";
import ClericEditor from "./components/ClericEditor";
import SkillLibrary from "./components/SkillLibrary";
import ClericSkillPanel from "./components/ClericSkillPanel";

type EditorState = { open: boolean; mode: "create" | "edit"; initial: ClericRow | null };
type TabKey = "clerics" | "skills";

/**
 * Owns the `activeCapId` state shared between the rail and the list. Pulled out
 * so the parent can `key` it on the cleric id — switching clerics remounts this
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
  const [hoveredCapId, setHoveredCapId] = useState<string | null>(null);

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
            hoveredId={hoveredCapId}
            onSelect={setActiveCapId}
            onHover={setHoveredCapId}
          />
        )}
      </CyberPanel>

      <CyberPanel className="p-5" markers={["br"]} accent>
        <CapabilityList
          summaries={capabilities}
          locale={locale}
          activeId={activeCapId}
          hoveredId={hoveredCapId}
          onSelect={setActiveCapId}
          onHover={setHoveredCapId}
          isAdmin={isAdmin}
        />
      </CyberPanel>
    </>
  );
}

export default function ClericClient({
  clerics,
  isAdmin,
  capabilitiesByCodename,
  skills,
  equipsByClericId,
}: {
  clerics: ClericRow[];
  isAdmin: boolean;
  capabilitiesByCodename: Record<string, CapabilitySummary[]>;
  skills: SkillRow[];
  equipsByClericId: Record<string, EquipRow[]>;
}) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [activeId, setActiveId] = useState<string | null>(clerics[0]?.id ?? null);
  const [editor, setEditor] = useState<EditorState>({ open: false, mode: "create", initial: null });

  const activeTab: TabKey = searchParams.get("tab") === "skills" ? "skills" : "clerics";

  function switchTab(tab: TabKey) {
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", tab);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  const activeCleric = useMemo(
    () => (activeId ? clerics.find((a) => a.id === activeId) ?? null : null),
    [clerics, activeId],
  );

  const activeCapabilities: CapabilitySummary[] = useMemo(
    () => (activeCleric ? capabilitiesByCodename[activeCleric.codename] ?? [] : []),
    [activeCleric, capabilitiesByCodename],
  );

  const activeEquips: EquipRow[] = useMemo(
    () => (activeId ? (equipsByClericId[activeId] ?? []) : []),
    [activeId, equipsByClericId],
  );

  function openCreate() {
    setEditor({ open: true, mode: "create", initial: null });
  }
  function onSaved() {
    router.refresh();
  }

  return (
    <main className="flex-1 flex flex-col w-full max-w-[1440px] mx-auto px-4 md:px-8 py-5 md:py-7 gap-5">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <span className="font-label text-[10px] tracking-[0.4em] text-secondary uppercase">
            {t.aiClergy.pageLabel}
          </span>
          <h1 className="mt-1 font-headline text-3xl md:text-4xl text-primary sacred-glow leading-tight">
            {t.aiClergy.pageTitle}
          </h1>
        </div>

        <div className="flex items-end gap-0 border-b border-primary/20 self-end">
          {(["clerics", "skills"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => switchTab(tab)}
              className={[
                "min-h-[44px] px-6 font-label text-[10px] tracking-[0.3em] uppercase transition-colors border-b-2",
                activeTab === tab
                  ? "text-primary border-primary"
                  : "text-on-surface-variant border-transparent hover:text-primary/70",
              ].join(" ")}
            >
              {tab === "clerics" ? t.aiClergy.tabClerics : t.aiClergy.tabSkillLibrary}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "skills" ? (
        <SkillLibrary
          skills={skills}
          equipsByClericId={equipsByClericId}
          activeClericId={activeId}
          isAdmin={isAdmin}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <CyberPanel className="lg:col-span-3 p-4 flex flex-col min-h-[420px]" markers={["tl", "br"]}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">
                {t.aiClergy.clericRoster}
              </h2>
              <span className="material-symbols-outlined text-outline" aria-hidden>
                hub
              </span>
            </div>
            {clerics.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-on-surface-variant text-sm">
                {t.aiClergy.emptyState}
              </div>
            ) : (
              <div className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1">
                {clerics.map((a) => (
                  <ClericListItem key={a.id} cleric={a} active={a.id === activeId} onSelect={setActiveId} />
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
                {t.aiClergy.ordainCleric}
              </button>
            ) : null}
          </CyberPanel>

          <CyberPanel className="lg:col-span-4 p-5" markers={["tl", "br"]}>
            {activeCleric ? (
              <div className="flex flex-col gap-5 h-full">
                <HologramCard cleric={activeCleric} />
                <div className="border-t border-outline-variant/30 pt-4">
                  <BaseStatsBar cleric={activeCleric} />
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-on-surface-variant text-sm">
                {t.aiClergy.noClericSelected}
              </div>
            )}
          </CyberPanel>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <CapabilityPair
              key={activeCleric?.id ?? "no-cleric"}
              capabilities={activeCapabilities}
              emptyText={t.aiClergy.capabilityEmpty}
              skillProgressionLabel={t.aiClergy.skillProgression}
              locale={locale}
              isAdmin={isAdmin}
            />

            {activeCleric && (
              <ClericSkillPanel
                key={`skill-panel-${activeCleric.id}`}
                clericId={activeCleric.id}
                equips={activeEquips}
                allSkills={skills}
                isAdmin={isAdmin}
              />
            )}
          </div>
        </div>
      )}

      {editor.open ? (
        <ClericEditor
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
