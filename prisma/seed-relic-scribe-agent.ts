// One-off seed: creates the RELIC-SCRIBE-001 agent, equips the two scribe
// skills to slots 0 and 1, sets the Backbone (pipelineConfig), and deploys.
// Idempotent — re-run safe.
//
// Prereq: prisma/seed-relic-scribe-skills.ts must have been run first
// (this script looks up skills by nameEn).
//
// Run: npx tsx prisma/seed-relic-scribe-agent.ts

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const CODENAME = "RELIC-SCRIBE-001";
const FILES_SUMMARY_NAME_EN = "Relic Files Summary";
const METADATA_NAME_EN = "Relic Metadata Scribe";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    throw new Error("Refusing to seed in production. Set ALLOW_PROD_SEED=1 to override.");
  }

  const filesSummary = await prisma.skill.findFirst({
    where: { nameEn: FILES_SUMMARY_NAME_EN },
  });
  const metadata = await prisma.skill.findFirst({
    where: { nameEn: METADATA_NAME_EN },
  });
  if (!filesSummary || !metadata) {
    throw new Error(
      `Required skills missing. Run prisma/seed-relic-scribe-skills.ts first.`,
    );
  }

  const pipelineConfig = {
    version: 1,
    steps: [
      {
        id: "summary",
        equipSlot: 0,
        inputMapping: { from: "agent.input" },
      },
      {
        id: "metadata",
        equipSlot: 1,
        inputMapping: { from: "summary.output" },
      },
    ],
  };

  // Avatar must be NOT NULL. Reuse the placeholder under /public/images/.
  const avatarUrl = "/images/agent-control/avatars/default.svg";

  const agentData = {
    codename: CODENAME,
    codenameZh: "遗物执笔者-001",
    nameEn: "Relic Scribe",
    nameZh: "遗物执笔者",
    mode: "MECHANICAL" as const,
    avatarUrl,
    descriptionEn:
      "Reads an uploaded relic's files + draft note and assigns the icon, title, subtitle, and rarity used in the vault UI.",
    descriptionZh:
      "读取用户上传的遗物文件与描述,产出 vault 界面所用的图标、标题、副标题与稀有度。",
    pipelineConfig: pipelineConfig as Prisma.InputJsonValue,
    dispatcherConfig: Prisma.JsonNull,
    deployedAt: new Date(),
  };

  const existing = await prisma.agent.findUnique({ where: { codename: CODENAME } });

  let agent;
  if (existing) {
    agent = await prisma.agent.update({ where: { id: existing.id }, data: agentData });
    console.log("✓ agent updated:", agent.codename, agent.id);
  } else {
    agent = await prisma.agent.create({ data: agentData });
    console.log("✓ agent created:", agent.codename, agent.id);
  }

  // Replace equips for slot 0/1 atomically.
  await prisma.$transaction(async (tx) => {
    await tx.agentSkillEquip.deleteMany({
      where: { agentId: agent.id, slotIndex: { in: [0, 1] } },
    });
    await tx.agentSkillEquip.create({
      data: {
        agentId: agent.id,
        skillId: filesSummary.id,
        slotIndex: 0,
        unlocked: true,
      },
    });
    await tx.agentSkillEquip.create({
      data: {
        agentId: agent.id,
        skillId: metadata.id,
        slotIndex: 1,
        unlocked: true,
      },
    });
  });
  console.log(`✓ slot 0 ← ${FILES_SUMMARY_NAME_EN}`);
  console.log(`✓ slot 1 ← ${METADATA_NAME_EN}`);
  console.log("✓ Backbone:", JSON.stringify(pipelineConfig));
  console.log("✓ Deployed at:", agent.deployedAt?.toISOString());

  console.log("\nVerify:");
  console.log("  /agent-control?tab=agents → select RELIC-SCRIBE-001");
  console.log("  Test Run with input: {\"relicSlug\": \"<some-existing-relic-slug>\"}");
  console.log("  Or upload a new relic at /relic-collection — pipeline auto-runs.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
