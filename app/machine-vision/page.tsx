import { redirect } from "next/navigation";
import Link from "next/link";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import UserMenu from "@/components/UserMenu";
import AgentClient from "./AgentClient";
import type { AgentRow } from "./types";
import type { AgentSkill } from "@/lib/agentTypes";
import { getCapabilitySummariesByAgent } from "@/lib/agents/summary";

export default async function MachineVisionPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login?from=/machine-vision");
  const t = await getDictionary();

  const agents = await prisma.agent.findMany({
    orderBy: [{ serial: "asc" }, { createdAt: "asc" }],
    include: { createdBy: { select: { id: true, name: true } } },
  });

  const rows: AgentRow[] = agents.map((a) => ({
    id: a.id,
    serial: a.serial,
    codename: a.codename,
    nameEn: a.nameEn,
    nameZh: a.nameZh,
    classification: a.classification,
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
    skills: (a.skills as AgentSkill[] | null) ?? null,
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

  const isAdmin = me.level >= ADMIN_LEVEL;

  const capabilitiesByCodename = await getCapabilitySummariesByAgent(
    rows.map((r) => ({ id: r.id, codename: r.codename })),
  );

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
          <span className="hidden lg:inline text-secondary">{t.machineVision.pageLabel}</span>
          <Link
            href="/"
            className="hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 rounded-sm"
          >
            {t.machineVision.backToSanctuary}
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

      <AgentClient agents={rows} isAdmin={isAdmin} capabilitiesByCodename={capabilitiesByCodename} />
    </div>
  );
}
