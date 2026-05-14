// Permanently retires PICKER-FORGE-001.
//
// 2026-05-14: PICKER-FORGE-001 was removed. The relic.smart-image-pick scene
// it served has graceful fallback in lib/relics/pipeline/steps/generateMetadata.ts
// (largest user candidate becomes primary; no network image augmentation).
//
// What this migration does (all idempotent — runs cleanly even if PICKER
// is already gone):
//   1. Delete SceneBinding for relic.smart-image-pick (FK Restrict on the
//      agent FK requires this to come BEFORE the agent delete).
//   2. Delete PICKER-FORGE-001 agent (cascades AgentSkillEquip + AgentJobs).
//   3. Delete the two skills only PICKER used:
//        - serp-image-search        (SerpAPI google_images keyword search)
//        - vision-compare-candidates (Gemini multi-image SAME-product judge)
//      The shared download-network-image skill stays — LENS-FORGE-001 uses it.
//
// What this DOES NOT touch:
//   - download-network-image (now owned by migrate-shared-network-skills.ts)
//   - The scene definition itself in lib/relics/scenes.ts (intentionally left
//     so any future agent can re-bind by creating a new SceneBinding row).
//   - lib/relics/pipeline/steps/generateMetadata.ts call site (fallback path
//     handles missing scene gracefully).
//
// To resurrect PICKER: restore prior migrate-picker-forge.ts from git
// history and re-add to npm start chain.

import { PrismaClient } from "@prisma/client";

const RETIRED_AGENT_CODENAME = "PICKER-FORGE-001";
const RETIRED_SCENE_KEY = "relic.smart-image-pick";
const RETIRED_SKILLS = ["serp-image-search", "vision-compare-candidates"];

async function main() {
  const prisma = new PrismaClient();
  try {
    // Schema gate — earlier migrations must have established the tables.
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log(
        "[migrate-picker-removal] SceneBinding table absent — skip (run earlier migrations first)",
      );
      return;
    }

    // 1. Drop binding first (FK Restrict on Agent forces this order).
    const binding = await prisma.sceneBinding.findUnique({
      where: { sceneKey: RETIRED_SCENE_KEY },
    });
    if (binding) {
      await prisma.sceneBinding.delete({ where: { sceneKey: RETIRED_SCENE_KEY } });
      console.log(`[migrate-picker-removal] dropped SceneBinding for ${RETIRED_SCENE_KEY}`);
    }

    // 2. Drop the agent (cascades AgentSkillEquip + AgentJob).
    const agent = await prisma.agent.findUnique({
      where: { codename: RETIRED_AGENT_CODENAME },
    });
    if (agent) {
      await prisma.agent.delete({ where: { id: agent.id } });
      console.log(`[migrate-picker-removal] dropped agent ${RETIRED_AGENT_CODENAME} (${agent.id})`);
    }

    // 3. Drop the two unique skills (download-network-image stays — shared).
    for (const slug of RETIRED_SKILLS) {
      const skill = await prisma.skill.findUnique({ where: { slug } });
      if (skill) {
        // AgentSkillEquip cascade deletes via Skill FK; if any other agent
        // still equipped these (shouldn't, but defensive), the cascade
        // handles it. Bindings via the skill's id don't exist (Skill is
        // referenced only from AgentSkillEquip).
        await prisma.skill.delete({ where: { id: skill.id } });
        console.log(`[migrate-picker-removal] dropped skill ${slug} (${skill.id})`);
      }
    }

    console.log("[migrate-picker-removal] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-picker-removal] failed:", e);
  process.exit(1);
});
