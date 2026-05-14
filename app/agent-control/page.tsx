import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import UserMenu from "@/components/UserMenu";
import AgentClient from "./AgentClient";
import type {
  AgentRow,
  SkillRow,
  EquipRow,
  SceneBindingRow,
  AgentPickerOption,
  SerializableSceneDef,
} from "./types";
import type { AgentSkill, PipelineConfig, DispatcherConfig } from "@/lib/agentTypes";
import { listSerializableScenes } from "@/lib/agent-service";
import type { BoundSceneSummary } from "./types";
// Side-effect: triggers each module's scenes.ts → registerScene at server
// boot. Without this, listSerializableScenes() returns an empty list and
// the Scenes tab appears empty even though bindings exist in DB.
import "@/lib/scenes-init";

export default async function AgentControlPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login?from=/agent-control");

  const [agents, skillsRaw, equipRecords, bindingRecords] = await Promise.all([
    prisma.agent.findMany({
      orderBy: [{ displayOrder: "asc" }, { serial: "asc" }, { createdAt: "asc" }],
      include: { createdBy: { select: { id: true, name: true } } },
    }),
    prisma.skill.findMany({
      orderBy: [{ level: "asc" }, { kind: "asc" }],
      include: { createdBy: { select: { id: true, name: true } } },
    }),
    prisma.agentSkillEquip.findMany({
      include: {
        skill: { include: { createdBy: { select: { id: true, name: true } } } },
      },
      orderBy: [{ slotIndex: "asc" }],
    }),
    prisma.sceneBinding.findMany({
      orderBy: { sceneKey: "asc" },
      include: {
        agent: {
          select: {
            id: true,
            codename: true,
            mode: true,
            deployedAt: true,
            capabilities: true,
          },
        },
      },
    }),
  ]);

  // Pre-build the agent → bound-scenes index. listSerializableScenes
  // already gives us the field hints for both context and output, so we
  // just join SceneBindings to that map by sceneKey. Agents with no
  // bindings get [] (BackboneFlowEditor renders nothing extra).
  const allScenes = listSerializableScenes();
  const sceneBySceneKey = new Map(allScenes.map((s) => [s.key, s]));
  const boundScenesByAgentId = bindingRecords.reduce<Record<string, BoundSceneSummary[]>>(
    (acc, b) => {
      const def = sceneBySceneKey.get(b.sceneKey);
      if (!def) return acc; // binding for an unregistered scene — ignore
      (acc[b.agentId] ??= []).push({
        sceneKey: b.sceneKey,
        module: def.module,
        invocation: def.invocation,
        label: def.label,
        contextFields: def.contextFields,
        outputFields: def.outputFields,
        via: "binding",
      });
      return acc;
    },
    {},
  );

  // Merge in draft-phase intent claims that haven't been deployed yet.
  // Intent + binding for the same scene de-dupes to the binding entry
  // (binding is the production-routable row).
  for (const a of agents) {
    const list = (boundScenesByAgentId[a.id] ??= []);
    const haveKeys = new Set(list.map((s) => s.sceneKey));
    for (const sceneKey of a.intentSceneKeys) {
      if (haveKeys.has(sceneKey)) continue;
      const def = sceneBySceneKey.get(sceneKey);
      if (!def) continue;
      list.push({
        sceneKey,
        module: def.module,
        invocation: def.invocation,
        label: def.label,
        contextFields: def.contextFields,
        outputFields: def.outputFields,
        via: "intent",
      });
    }
  }

  const rows: AgentRow[] = agents.map((a) => ({
    id: a.id,
    serial: a.serial,
    codename: a.codename,
    codenameZh: a.codenameZh,
    nameEn: a.nameEn,
    nameZh: a.nameZh,
    mode: a.mode,
    status: a.status,
    avatarUrl: a.avatarUrl,
    syncLevel: a.syncLevel,
    matrixLevel: a.matrixLevel,
    chaosLevel: a.chaosLevel,
    costTier: a.costTier,
    activityLevel: a.activityLevel,
    stabilityLevel: a.stabilityLevel,
    pipelineConfig: (a.pipelineConfig as PipelineConfig | null) ?? null,
    dispatcherConfig: (a.dispatcherConfig as DispatcherConfig | null) ?? null,
    deployedAt: a.deployedAt ? a.deployedAt.toISOString() : null,
    skills: (a.skills as AgentSkill[] | null) ?? null,
    availableAp: a.availableAp,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    createdBy: a.createdBy,
    boundScenes: boundScenesByAgentId[a.id] ?? [],
    intentSceneKeys: a.intentSceneKeys,
    capabilities: a.capabilities,
  }));

  // Helpers cast Prisma's loose JsonValue to the concrete shape SkillRow expects.
  // handlerConfig defaults to {} (DB has dbgenerated default), inputSchema/outputSchema
  // are nullable.
  const toCfg = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const toSchema = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

  const skills: SkillRow[] = skillsRaw.map((s) => ({
    id: s.id,
    slug: s.slug,
    level: s.level,
    icon: s.icon,
    nameEn: s.nameEn,
    nameZh: s.nameZh,
    kind: s.kind as SkillRow["kind"],
    status: s.status as SkillRow["status"],
    costAp: s.costAp,
    descriptionEn: s.descriptionEn,
    descriptionZh: s.descriptionZh,
    handlerConfig: toCfg(s.handlerConfig),
    inputSchema: toSchema(s.inputSchema),
    outputSchema: toSchema(s.outputSchema),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    createdBy: s.createdBy,
  }));

  const equipsByAgentId = equipRecords.reduce<Record<string, EquipRow[]>>((acc, r) => {
    const equip: EquipRow = {
      id: r.id,
      agentId: r.agentId,
      skillId: r.skillId,
      skill: {
        id: r.skill.id,
        slug: r.skill.slug,
        level: r.skill.level,
        icon: r.skill.icon,
        nameEn: r.skill.nameEn,
        nameZh: r.skill.nameZh,
        kind: r.skill.kind as SkillRow["kind"],
        status: r.skill.status as SkillRow["status"],
        costAp: r.skill.costAp,
        descriptionEn: r.skill.descriptionEn,
        descriptionZh: r.skill.descriptionZh,
        handlerConfig: toCfg(r.skill.handlerConfig),
        inputSchema: toSchema(r.skill.inputSchema),
        outputSchema: toSchema(r.skill.outputSchema),
        createdAt: r.skill.createdAt.toISOString(),
        updatedAt: r.skill.updatedAt.toISOString(),
        createdBy: r.skill.createdBy,
      },
      unlocked: r.unlocked,
      slotIndex: r.slotIndex,
      equippedAt: r.equippedAt.toISOString(),
    };
    (acc[r.agentId] ??= []).push(equip);
    return acc;
  }, {});

  // Scene-binding view rows (denormalized agent join + ISO dates).
  const sceneBindings: SceneBindingRow[] = bindingRecords.map((b) => ({
    sceneKey: b.sceneKey,
    agentId: b.agentId,
    agentCodename: b.agent?.codename ?? null,
    agentMode: (b.agent?.mode as SceneBindingRow["agentMode"]) ?? null,
    agentDeployed: !!b.agent?.deployedAt,
    agentCapabilities: b.agent?.capabilities ?? [],
    enabled: b.enabled,
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }));

  // Compact agent options for the binding picker (no loadout / config).
  const agentOptions: AgentPickerOption[] = agents.map((a) => ({
    id: a.id,
    codename: a.codename,
    nameEn: a.nameEn,
    nameZh: a.nameZh,
    mode: a.mode as AgentPickerOption["mode"],
    deployedAt: a.deployedAt ? a.deployedAt.toISOString() : null,
    capabilities: a.capabilities,
  }));

  // Scene definitions (registry → serializable). Empty when scenes-init
  // wasn't imported above, which would mean none of the relic.* / etc.
  // scenes registered — that's a code-side bug, not a data issue.
  const sceneDefs: SerializableSceneDef[] = listSerializableScenes();

  const isAdmin = me.level >= ADMIN_LEVEL;

  return (
    <div className="flex flex-col flex-1 w-full min-h-0">
      <header className="w-full z-50 grid grid-cols-[1fr_auto_1fr] items-center px-5 md:px-10 py-[10px] md:py-1 bg-background/90 backdrop-blur-xl border-b border-primary/20 shrink-0 gap-3">
        <Link
          href="/"
          className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 rounded-sm justify-self-start"
        >
          Green Diva
        </Link>
        <div className="hidden md:flex items-center gap-3 justify-self-center whitespace-nowrap" aria-label="The Agent Control">
          <span aria-hidden className="block w-8 h-px bg-gradient-to-r from-transparent to-primary/50" />
          <span aria-hidden className="text-secondary/80 text-[10px] leading-none">◆</span>
          <span className="font-label text-[11px] tracking-[0.45em] uppercase text-primary sacred-glow">
            The Agent Control
          </span>
          <span aria-hidden className="text-secondary/80 text-[10px] leading-none">◆</span>
          <span aria-hidden className="block w-8 h-px bg-gradient-to-l from-transparent to-primary/50" />
        </div>
        <div className="flex items-center gap-3 sm:gap-5 md:gap-7 justify-self-end">
          <UserMenu
            user={{
              name: me.name,
              level: me.level,
              avatarUrl: me.avatarUrl,
              gender: me.gender,
            }}
            isAdmin={isAdmin}
          />
        </div>
      </header>

      <Suspense fallback={null}>
        <AgentClient
          agents={rows}
          isAdmin={isAdmin}
          skills={skills}
          equipsByAgentId={equipsByAgentId}
          sceneBindings={sceneBindings}
          sceneDefs={sceneDefs}
          agentOptions={agentOptions}
        />
      </Suspense>
    </div>
  );
}
