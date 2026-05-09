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
const SKILLS_BY_SLOT: Array<{ slot: number; nameEn: string }> = [
  { slot: 0, nameEn: "Relic Files Summary" },
  { slot: 1, nameEn: "Relic Metadata Scribe" },
  { slot: 2, nameEn: "Form Classifier" },
  { slot: 3, nameEn: "Relic Image Pick" },
  { slot: 4, nameEn: "Meshy 3D Generator" },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    throw new Error("Refusing to seed in production. Set ALLOW_PROD_SEED=1 to override.");
  }

  // Resolve all 5 skills by nameEn. Bail loudly if any are missing — the
  // agent's DAG references all 5 slots, partial seeds will leave empty
  // slots that fail at runtime with SLOT_EMPTY.
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

  // v2 DAG. Layout (left-to-right):
  //
  //   summary ─→ pick2d ────────────────────────→ metadata
  //          ╲                                    ╱
  //           ↓                                  ╱
  //         classify ─→ branch ─── twoD ────────╱
  //                          ╲      threeD                    ╲
  //                           ────→ meshy ───────────────────→ metadata
  //
  // Why pick2d runs unconditionally: meshy needs the chosen image, and the
  // 2D path needs it too. Meshy's input comes from pick2d via a merge.
  // metadata is the final leaf — receives a merge of all upstream outputs;
  // skipped nodes (meshy in the 2D case) contribute null. The pipeline step
  // (lib/relics/pipeline/steps/generateMetadata.ts) reads each node's output
  // out of the runLog by id to assemble the Relic writeback payload.
  const pipelineConfig = {
    version: 2 as const,
    nodes: [
      {
        id: "summary",
        type: "skill" as const,
        equipSlot: 0,
        inputFrom: "agent.input",
        position: { x: 60, y: 120 },
      },
      {
        id: "pick2d",
        type: "skill" as const,
        equipSlot: 3,
        inputFrom: "summary.output",
        position: { x: 320, y: 30 },
      },
      {
        id: "classify",
        type: "skill" as const,
        equipSlot: 2,
        inputFrom: "summary.output",
        position: { x: 320, y: 220 },
      },
      {
        id: "branch",
        type: "branch" as const,
        inputFrom: "classify.output",
        cases: [
          { path: "kind", op: "eq", value: "TWO_D", label: "twoD" },
          { path: "kind", op: "eq", value: "THREE_D", label: "threeD" },
        ],
        defaultLabel: "twoD",
        position: { x: 600, y: 220 },
      },
      {
        id: "meshy",
        type: "skill" as const,
        equipSlot: 4,
        inputFrom: {
          merge: {
            relicSlug: "summary.output.relicSlug",
            primaryImagePath: "pick2d.output.primaryImagePath",
          },
        },
        position: { x: 880, y: 220 },
      },
      {
        id: "metadata",
        type: "skill" as const,
        equipSlot: 1,
        inputFrom: {
          merge: {
            files: "summary.output",
            classify: "classify.output",
            twoD: "pick2d.output",
            threeD: "meshy.output",
          },
        },
        position: { x: 1160, y: 120 },
      },
    ],
    edges: [
      { from: "summary", to: "pick2d" },
      { from: "summary", to: "classify" },
      { from: "pick2d", to: "metadata" },
      { from: "classify", to: "branch" },
      { from: "branch", to: "metadata", when: "twoD" },
      { from: "branch", to: "meshy", when: "threeD" },
      { from: "meshy", to: "metadata" },
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

  // Replace equips for all 5 slots atomically.
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
