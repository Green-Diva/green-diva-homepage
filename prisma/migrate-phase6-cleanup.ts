// Phase 6.1 cleanup. Runs after LORE-FORGE-001 has handled relic.draft-
// metadata + relic.regen-metadata in production for at least one cycle
// without rollback. Idempotent.
//
// What it does:
//   1. Strips RELIC-SCRIBE-001's stale loadout: drops slots 0/1/2 equips
//      (relic-files-summary, relic-gemini-researcher, relic-smart-image-pick)
//      and clears the agent's pipelineConfig DAG. The forge agents have
//      their own equips for these handlers (or shared rows by skillId);
//      SCRIBE no longer needs them.
//   2. Drops the legacy "Relic Gemini Researcher" Skill row (handler
//      relic-gemini-researcher). Cascades equip rows. The relic-files-
//      summary and relic-smart-image-pick Skill rows STAY — LORE-FORGE
//      and any other forge agent equips them.
//   3. SCRIBE the agent row STAYS as a deactivated history record.
//      Admin can manually delete it from /agent-control if desired.
//
// Required env: DATABASE_URL.

import { PrismaClient } from "@prisma/client";

const SCRIBE_CODENAME = "RELIC-SCRIBE-001";

async function clearScribeLoadout(prisma: PrismaClient): Promise<void> {
  const scribe = await prisma.agent.findUnique({
    where: { codename: SCRIBE_CODENAME },
    select: { id: true },
  });
  if (!scribe) {
    console.log(`[migrate-phase6] ${SCRIBE_CODENAME} missing — skip`);
    return;
  }

  // Wipe pipelineConfig (DAG referenced node IDs that pointed at
  // gemini-researcher equip — drop them all). Phase 5 R1 already
  // removed cutout/meshy nodes; this finishes the job.
  await prisma.agent.update({
    where: { id: scribe.id },
    data: { pipelineConfig: { version: 2, nodes: [], edges: [] } },
  });
  console.log(`[migrate-phase6] cleared ${SCRIBE_CODENAME} pipelineConfig`);

  // Drop all remaining equips on SCRIBE (slots 0/1/2 from R1 leftovers).
  const dropped = await prisma.agentSkillEquip.deleteMany({
    where: { agentId: scribe.id },
  });
  if (dropped.count > 0) {
    console.log(`[migrate-phase6] dropped ${dropped.count} equip(s) from ${SCRIBE_CODENAME}`);
  } else {
    console.log(`[migrate-phase6] ${SCRIBE_CODENAME} already had no equips`);
  }
}

async function dropGeminiResearcherSkill(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ id: string; nameEn: string }[]>(
    `SELECT id, "nameEn" FROM "Skill"
     WHERE "handlerConfig"->>'handler' = 'relic-gemini-researcher'`,
  );
  if (rows.length === 0) {
    console.log("[migrate-phase6] no relic-gemini-researcher Skill row to drop");
    return;
  }
  for (const r of rows) {
    await prisma.skill.delete({ where: { id: r.id } });
    console.log(`[migrate-phase6] dropped Skill ${r.id} (${r.nameEn})`);
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await clearScribeLoadout(prisma);
    await dropGeminiResearcherSkill(prisma);
    console.log("[migrate-phase6] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-phase6] failed:", e);
  process.exit(1);
});
