"use client";

import { useMemo, useState } from "react";
import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type {
  SceneBindingRow,
  SerializableSceneDef,
  AgentPickerOption,
} from "../types";
import CyberPanel from "./CyberPanel";
import SceneBindingEditor from "./SceneBindingEditor";

type Group = { module: string; scenes: SerializableSceneDef[] };

export default function ScenesPanel({
  scenes,
  bindings,
  agents,
  isAdmin,
  onSaved,
}: {
  scenes: SerializableSceneDef[];
  bindings: SceneBindingRow[];
  agents: AgentPickerOption[];
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const bindingByKey = useMemo(() => {
    const m = new Map<string, SceneBindingRow>();
    for (const b of bindings) m.set(b.sceneKey, b);
    return m;
  }, [bindings]);

  const groups = useMemo<Group[]>(() => {
    const grouped = new Map<string, SerializableSceneDef[]>();
    for (const s of scenes) {
      const arr = grouped.get(s.module) ?? [];
      arr.push(s);
      grouped.set(s.module, arr);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, list]) => ({ module, scenes: list }));
  }, [scenes]);

  const editing = editingKey ? scenes.find((s) => s.key === editingKey) ?? null : null;

  if (scenes.length === 0) {
    return (
      <CyberPanel className="p-6" markers={["tl", "br"]}>
        <p className="text-on-surface-variant text-sm">{t.agentControl.scenesEmpty}</p>
      </CyberPanel>
    );
  }

  return (
    <>
      <div className="space-y-5 pb-6">
        <CyberPanel className="px-4 py-3" markers={["tl", "br"]}>
          <h2 className="font-label text-[10px] tracking-[0.3em] text-primary uppercase">
            {t.agentControl.scenesTitle}
          </h2>
        </CyberPanel>

        {groups.map((g) => (
          <section key={g.module} className="space-y-2">
            <div className="flex items-center gap-3 px-1">
              <span className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
                {g.module}
              </span>
              <span className="text-on-surface-variant text-xs">·</span>
              <span className="text-on-surface-variant text-xs">{g.scenes.length}</span>
              <span aria-hidden className="flex-1 h-px bg-primary/10" />
            </div>
            <div className="space-y-2">
              {g.scenes.map((scene) => (
                <SceneRow
                  key={scene.key}
                  scene={scene}
                  binding={bindingByKey.get(scene.key) ?? null}
                  locale={locale}
                  isAdmin={isAdmin}
                  onEdit={() => setEditingKey(scene.key)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {editing && isAdmin ? (
        <SceneBindingEditor
          scene={editing}
          binding={bindingByKey.get(editing.key) ?? null}
          agents={agents}
          onClose={() => setEditingKey(null)}
          onSaved={() => {
            setEditingKey(null);
            onSaved();
          }}
        />
      ) : null}
    </>
  );
}

function SceneRow({
  scene,
  binding,
  locale,
  isAdmin,
  onEdit,
}: {
  scene: SerializableSceneDef;
  binding: SceneBindingRow | null;
  locale: "en" | "zh";
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const label = scene.label[locale] ?? scene.label.en;
  const description = scene.description?.[locale] ?? scene.description?.en;

  return (
    <CyberPanel className="p-3" markers={["tl"]}>
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[240px] space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <InvocationBadge invocation={scene.invocation} />
            <code className="font-mono text-xs text-primary">{scene.key}</code>
          </div>
          <div className="text-sm font-semibold text-on-surface">{label}</div>
          {description ? (
            <div className="text-xs text-on-surface-variant">{description}</div>
          ) : null}
          {scene.requiredCapabilities.length > 0 ? (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="font-label text-[9px] tracking-[0.25em] uppercase text-on-surface-variant">
                {t.agentControl.sceneRequiredCaps}
              </span>
              {scene.requiredCapabilities.map((cap) => (
                <span
                  key={cap}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-primary/20 bg-primary/[0.05] text-primary/80 font-mono"
                >
                  {cap}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <BindingStatus binding={binding} />
          {isAdmin ? (
            <button
              type="button"
              onClick={onEdit}
              className="min-h-[32px] px-3 rounded border border-primary/40 bg-primary/[0.05] hover:bg-primary/[0.12] text-primary font-label text-[10px] tracking-[0.25em] uppercase transition-colors"
            >
              {t.agentControl.sceneEditBinding}
            </button>
          ) : null}
        </div>
      </div>
    </CyberPanel>
  );
}

function InvocationBadge({ invocation }: { invocation: "sync" | "async" }) {
  const t = useT();
  const label =
    invocation === "sync" ? t.agentControl.sceneInvocationSync : t.agentControl.sceneInvocationAsync;
  // Sync = secondary (gold), async = primary (cyan) — matches the
  // Mechanical/Autonomous mode color palette so admins read sync vs async
  // with the same instinct as machine vs agent.
  const cls =
    invocation === "sync"
      ? "border-secondary/40 bg-secondary/[0.08] text-secondary"
      : "border-primary/40 bg-primary/[0.08] text-primary";
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-label tracking-[0.2em] uppercase ${cls}`}
    >
      {label}
    </span>
  );
}

function BindingStatus({ binding }: { binding: SceneBindingRow | null }) {
  const t = useT();
  const base = "text-[11px] px-2 py-1 rounded border font-label tracking-[0.18em] uppercase";
  if (!binding) {
    return (
      <span className={`${base} border-rose-500/40 bg-rose-500/[0.08] text-rose-400`}>
        {t.agentControl.sceneStateUnbound}
      </span>
    );
  }
  if (!binding.enabled) {
    return (
      <span className={`${base} border-amber-500/40 bg-amber-500/[0.08] text-amber-400`}>
        {t.agentControl.sceneStateDisabled}
      </span>
    );
  }
  if (!binding.agentCodename) {
    return (
      <span className={`${base} border-rose-500/40 bg-rose-500/[0.08] text-rose-400`}>
        {t.agentControl.sceneStateAgentMissing}
      </span>
    );
  }
  if (!binding.agentDeployed) {
    return (
      <span className={`${base} border-amber-500/40 bg-amber-500/[0.08] text-amber-400`}>
        {t.agentControl.sceneStateAgentNotDeployed}
      </span>
    );
  }
  return (
    <span className={`${base} border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300`}>
      {format(t.agentControl.sceneStateBound, { codename: binding.agentCodename })}
    </span>
  );
}
