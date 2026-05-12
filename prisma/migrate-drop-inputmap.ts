// One-shot pre-push migration: drops SceneBinding.inputMap column.
//
// Why: the inputMap field used to live in DB so admins could template
// ctx → agent.input via `{{ctx.X}}` / `{{actor.X}}` strings. That design
// split the scene-agent contract across two layers (code = contextSchema,
// DB = inputMap) and let admin tweak shape silently. Cf. 2026-05-12
// all-in refactor.
//
// New design: scene.prepareAgentInput is a sync function on the
// SceneDefinition (lib/<module>/scenes.ts). Contract is wholly typed +
// owned by code. Bindings are pure routing (agentId + enabled + notes).
//
// Safety:
//   - Dumps every current inputMap to console (paper-trail) before drop.
//   - No "abort on unknown scene" guard — unlike outputMap, inputMap is
//     trivially recoverable from git history if needed (prepareAgentInput
//     bodies show the desired shape), and the 5 known relic.* scenes
//     all have prepareAgentInput defined post-refactor.
//   - Idempotent: re-runs after the column is gone are a no-op.

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-drop-inputmap] SceneBinding table absent — skip (run earlier migrations first)");
      return;
    }

    const colExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'SceneBinding' AND column_name = 'inputMap'
       ) AS exists`,
    );
    if (!colExists[0]?.exists) {
      console.log("[migrate-drop-inputmap] inputMap column already dropped — no-op");
      return;
    }

    const rows = await prisma.$queryRawUnsafe<
      { sceneKey: string; inputMap: unknown }[]
    >(`SELECT "sceneKey", "inputMap" FROM "SceneBinding" ORDER BY "sceneKey"`);
    console.log(`[migrate-drop-inputmap] current bindings (${rows.length}):`);
    for (const r of rows) {
      const dump = r.inputMap === null ? "null" : JSON.stringify(r.inputMap);
      console.log(`  ${r.sceneKey} → ${dump}`);
    }

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "SceneBinding" DROP COLUMN IF EXISTS "inputMap"`,
    );
    console.log("[migrate-drop-inputmap] dropped SceneBinding.inputMap column");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-drop-inputmap] failed:", e);
  process.exit(1);
});
