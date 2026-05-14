// One-off seed: configures the RELIC-SCRIBE-001 agent's slot loadout +
// 4-mode DAG. Idempotent — re-run safe.
//
// Prereq: prisma/seed-relic-scribe-skills.ts must have run first.
//
// Run: npx tsx prisma/seed-relic-scribe-agent.ts

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const CODENAME = "RELIC-SCRIBE-001";

const SKILLS_BY_SLOT: Array<{ slot: number; nameEn: string }> = [
  { slot: 0, nameEn: "Relic Files Summary" },
  { slot: 1, nameEn: "Relic Gemini Researcher" },
  { slot: 2, nameEn: "Relic Smart Image Picker" },
  { slot: 3, nameEn: "Relic Background Cutout" },
  { slot: 4, nameEn: "Meshy 3D Generator" },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    throw new Error("Refusing to seed in production. Set ALLOW_PROD_SEED=1 to override.");
  }

  // Resolve all 5 skills by nameEn.
  const skillIdBySlot = new Map<number, string>();
  for (const { slot, nameEn } of SKILLS_BY_SLOT) {
    const skill = await prisma.skill.findFirst({ where: { nameEn } });
    if (!skill) {
      throw new Error(
        `Required skill missing: "${nameEn}" — run prisma/seed-relic-scribe-skills.ts first`,
      );
    }
    skillIdBySlot.set(slot, skill.id);
  }

  // 4-mode DAG. mode-router branches on agent.input.mode → routes to one of
  // 4 leaf paths. See docs/relic-immutable-frog.md (or the original plan)
  // for layout + reasoning. Key invariant: 3D path takes the *enhanced*
  // image (transparent PNG), not the raw primary — meshy.imagePath is
  // sourced from the trigger endpoint's input.imagePath, which the
  // /create-3d endpoint sets to relic.enhancedImagePath.
  const pipelineConfig = {
    version: 2 as const,
    nodes: [
      {
        id: "mode",
        type: "branch" as const,
        inputFrom: "agent.input",
        cases: [
          { path: "mode", op: "eq" as const, value: "initial", label: "initial" },
          { path: "mode", op: "eq" as const, value: "regenMetadata", label: "regen" },
          { path: "mode", op: "eq" as const, value: "2dEnhance", label: "twoD" },
          { path: "mode", op: "eq" as const, value: "3dCreate", label: "threeD" },
        ],
        defaultLabel: "initial",
        position: { x: 60, y: 240 },
      },
      // Initial path: summary → research → pick.
      {
        id: "summary",
        type: "skill" as const,
        equipSlot: 0,
        inputFrom: "agent.input",
        position: { x: 320, y: 80 },
      },
      {
        id: "research",
        type: "skill" as const,
        equipSlot: 1,
        inputFrom: "summary.output",
        position: { x: 600, y: 80 },
      },
      {
        id: "pick",
        type: "skill" as const,
        equipSlot: 2,
        inputFrom: {
          merge: {
            relicSlug: "summary.output.relicSlug",
            imageAbsPaths: "summary.output.imageAbsPaths",
            useUserImage: "research.output.useUserImage",
            networkImageQuery: "research.output.networkImageQuery",
          },
        },
        position: { x: 880, y: 80 },
      },
      // Regen path: same Researcher skill (slot 1), different node id so
      // it can have a different inputFrom (agent.input directly, no summary).
      {
        id: "research-regen",
        type: "skill" as const,
        equipSlot: 1,
        inputFrom: "agent.input",
        position: { x: 320, y: 240 },
      },
      // 2D enhance leaf.
      {
        id: "cutout",
        type: "skill" as const,
        equipSlot: 3,
        inputFrom: "agent.input",
        position: { x: 320, y: 380 },
      },
      // 3D create leaf — directly from mode-router; gets agent.input.imagePath
      // which the /create-3d endpoint sets to relic.enhancedImagePath.
      {
        id: "meshy",
        type: "skill" as const,
        equipSlot: 4,
        inputFrom: "agent.input",
        position: { x: 320, y: 520 },
      },
    ],
    edges: [
      { from: "mode", to: "summary", when: "initial" },
      { from: "mode", to: "research-regen", when: "regen" },
      { from: "mode", to: "cutout", when: "twoD" },
      { from: "mode", to: "meshy", when: "threeD" },
      { from: "summary", to: "research" },
      { from: "research", to: "pick" },
    ],
  };

  const avatarUrl = "/images/agent-control/avatars/default.svg";

  const agentData = {
    codename: CODENAME,
    codenameZh: "遗物执笔者-001",
    nameEn: "Relic Scribe",
    nameZh: "遗物执笔者",
    mode: "MECHANICAL" as const,
    avatarUrl,
    pipelineConfig: pipelineConfig as unknown as Prisma.InputJsonValue,
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

  // Replace equips for slots 0-4 atomically.
  const slotsToReplace = SKILLS_BY_SLOT.map((s) => s.slot);
  await prisma.$transaction(async (tx) => {
    await tx.agentSkillEquip.deleteMany({
      where: { agentId: agent.id, slotIndex: { in: slotsToReplace } },
    });
    for (const { slot } of SKILLS_BY_SLOT) {
      await tx.agentSkillEquip.create({
        data: {
          agentId: agent.id,
          skillId: skillIdBySlot.get(slot)!,
          slotIndex: slot,
          unlocked: true,
        },
      });
    }
  });
  for (const { slot, nameEn } of SKILLS_BY_SLOT) {
    console.log(`✓ slot ${slot} ← ${nameEn}`);
  }
  console.log("✓ Deployed at:", agent.deployedAt?.toISOString());

  console.log("\nVerify:");
  console.log("  /agent-control?tab=agents → select RELIC-SCRIBE-001");
  console.log("  Test Run with input: {\"mode\":\"initial\",\"relicSlug\":\"<existing-slug>\"}");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
