import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import UserMenu from "@/components/UserMenu";
import ClericClient from "./ClericClient";
import type { ClericRow, SkillRow, EquipRow } from "./types";
import type { ClericSkill } from "@/lib/clericTypes";
import { getCapabilitySummariesByCleric } from "@/lib/clerics/summary";

export default async function MachineVisionPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login?from=/ai-clergy");
  const t = await getDictionary();

  const [clerics, skillsRaw, equipRecords] = await Promise.all([
    prisma.cleric.findMany({
      orderBy: [{ serial: "asc" }, { createdAt: "asc" }],
      include: { createdBy: { select: { id: true, name: true } } },
    }),
    prisma.skill.findMany({
      orderBy: [{ level: "asc" }, { kind: "asc" }],
      include: { createdBy: { select: { id: true, name: true } } },
    }),
    prisma.clericSkillEquip.findMany({
      include: {
        skill: { include: { createdBy: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  const capabilitiesByCodename = await getCapabilitySummariesByCleric(
    clerics.map((c) => ({ id: c.id, codename: c.codename })),
  );

  const rows: ClericRow[] = clerics.map((a) => ({
    id: a.id,
    serial: a.serial,
    codename: a.codename,
    nameEn: a.nameEn,
    nameZh: a.nameZh,
    classification: a.classification,
    mode: a.mode,
    status: a.status,
    avatarUrl: a.avatarUrl,
    descriptionEn: a.descriptionEn,
    descriptionZh: a.descriptionZh,
    syncLevel: a.syncLevel,
    matrixLevel: a.matrixLevel,
    quickness: a.quickness,
    intelligence: a.intelligence,
    neuralLink: a.neuralLink,
    bioSync: a.bioSync,
    logic: a.logic,
    compassion: a.compassion,
    skills: (a.skills as ClericSkill[] | null) ?? null,
    availableAp: a.availableAp,
    enabled: a.enabled,
    provider: a.provider,
    model: a.model,
    systemPrompt: a.systemPrompt,
    internalHandler: a.internalHandler,
    inputSchemaJson: a.inputSchemaJson,
    outputSchemaJson: a.outputSchemaJson,
    maxTokens: a.maxTokens,
    temperature: a.temperature,
    rateLimitPerMin: a.rateLimitPerMin,
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
    costAp: s.costAp,
    descriptionEn: s.descriptionEn,
    descriptionZh: s.descriptionZh,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    createdBy: s.createdBy,
  }));

  const equipsByClericId = equipRecords.reduce<Record<string, EquipRow[]>>((acc, r) => {
    const equip: EquipRow = {
      id: r.id,
      clericId: r.clericId,
      skillId: r.skillId,
      skill: {
        id: r.skill.id,
        level: r.skill.level,
        icon: r.skill.icon,
        nameEn: r.skill.nameEn,
        nameZh: r.skill.nameZh,
        kind: r.skill.kind as SkillRow["kind"],
        costAp: r.skill.costAp,
        descriptionEn: r.skill.descriptionEn,
        descriptionZh: r.skill.descriptionZh,
        createdAt: r.skill.createdAt.toISOString(),
        updatedAt: r.skill.updatedAt.toISOString(),
        createdBy: r.skill.createdBy,
      },
      unlocked: r.unlocked,
      equippedAt: r.equippedAt.toISOString(),
    };
    (acc[r.clericId] ??= []).push(equip);
    return acc;
  }, {});

  const isAdmin = me.level >= ADMIN_LEVEL;

  return (
    <div className="flex flex-col flex-1 w-full">
      <header className="w-full z-30 flex justify-between items-center px-5 md:px-10 py-[10px] md:py-1 bg-background/90 backdrop-blur-xl border-b border-primary/20 shrink-0 gap-3">
        <Link
          href="/"
          className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 rounded-sm"
        >
          Green Diva
        </Link>
        <div className="hidden md:flex items-center gap-4 font-label text-[11px] tracking-[0.3em] text-primary/70 uppercase">
          <span className="hidden lg:inline text-secondary">{t.aiClergy.pageLabel}</span>
          <Link
            href="/"
            className="hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 rounded-sm"
          >
            {t.aiClergy.backToSanctuary}
          </Link>
        </div>
        <div className="flex items-center gap-3 sm:gap-5 md:gap-7">
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
        <ClericClient
          clerics={rows}
          isAdmin={isAdmin}
          capabilitiesByCodename={capabilitiesByCodename}
          skills={skills}
          equipsByClericId={equipsByClericId}
        />
      </Suspense>
    </div>
  );
}
