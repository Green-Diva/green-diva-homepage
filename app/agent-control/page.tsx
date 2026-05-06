import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import UserMenu from "@/components/UserMenu";
import AgentClient from "./AgentClient";
import type { AgentRow, SkillRow, EquipRow } from "./types";
import type { AgentSkill, PipelineConfig, DispatcherConfig } from "@/lib/agentTypes";

export default async function MachineAgentPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login?from=/agent-control");

  const [agents, skillsRaw, equipRecords] = await Promise.all([
    prisma.agent.findMany({
      orderBy: [{ serial: "asc" }, { createdAt: "asc" }],
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
  ]);

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
    descriptionEn: a.descriptionEn,
    descriptionZh: a.descriptionZh,
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
  }));

  const skills: SkillRow[] = skillsRaw.map((s) => ({
    id: s.id,
    level: s.level,
    icon: s.icon,
    nameEn: s.nameEn,
    nameZh: s.nameZh,
    kind: s.kind as SkillRow["kind"],
    status: s.status as SkillRow["status"],
    costAp: s.costAp,
    descriptionEn: s.descriptionEn,
    descriptionZh: s.descriptionZh,
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
        level: r.skill.level,
        icon: r.skill.icon,
        nameEn: r.skill.nameEn,
        nameZh: r.skill.nameZh,
        kind: r.skill.kind as SkillRow["kind"],
        status: r.skill.status as SkillRow["status"],
        costAp: r.skill.costAp,
        descriptionEn: r.skill.descriptionEn,
        descriptionZh: r.skill.descriptionZh,
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

  const isAdmin = me.level >= ADMIN_LEVEL;

  return (
    <div className="flex flex-col flex-1 w-full">
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
        />
      </Suspense>
    </div>
  );
}
