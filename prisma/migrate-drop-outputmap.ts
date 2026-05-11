// One-shot pre-push migration: drops SceneBinding.outputMap column.
//
// Why: the outputMap field used to live in DB so admins could reshape an
// agent's leaf output into the scene's expected shape per-binding. That
// design pushed the contract surface into DB (implicit) — admins could
// silently break pipeline by renaming agent node ids that outputMap
// referenced. Cf. plan: scenebinding-outputmap-peaceful-token.md.
//
// New design: scene.outputSchema is the single source of truth. Each
// agent self-shapes via a tail `transform` node. Pre-push migrations
// (this one) drop the column; post-push forge migrations install the
// tail transforms.
//
// Safety:
//   - Dumps every current outputMap to console (paper-trail) before drop.
//   - Aborts if any non-relic.* SceneBinding has a non-null outputMap
//     (custom admin bindings whose owner needs to convert manually).
//   - Idempotent: re-runs after the column is gone are a no-op.

import { PrismaClient } from "@prisma/client";

const KNOWN_RELIC_SCENES = new Set([
  // Both pre- and post-2026-05-11-rename keys; this script is idempotent
  // and may run on databases at either point in the rename rollout.
  "relic.draft-metadata",
  "relic.generate-draft-metadata",
  "relic.regen-metadata",
  "relic.smart-image-pick",
  "relic.enhance2d",
  "relic.create3d",
]);

async function main() {
  const prisma = new PrismaClient();
  try {
    // Has the SceneBinding table been created yet?
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-drop-outputmap] SceneBinding table absent — skip (run earlier migrations first)");
      return;
    }

    // Has the outputMap column already been dropped? Idempotent re-run.
    const colExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'SceneBinding' AND column_name = 'outputMap'
       ) AS exists`,
    );
    if (!colExists[0]?.exists) {
      console.log("[migrate-drop-outputmap] outputMap column already dropped — no-op");
      return;
    }

    // Dump every current outputMap as a paper-trail before destruction.
    const rows = await prisma.$queryRawUnsafe<
      { sceneKey: string; outputMap: unknown }[]
    >(`SELECT "sceneKey", "outputMap" FROM "SceneBinding" ORDER BY "sceneKey"`);
    console.log(`[migrate-drop-outputmap] current bindings (${rows.length}):`);
    for (const r of rows) {
      const dump = r.outputMap === null ? "null" : JSON.stringify(r.outputMap);
      console.log(`  ${r.sceneKey} → ${dump}`);
    }

    // Abort if a non-recognized scene has a non-null outputMap. The 5
    // known relic.* scenes get their reshape handled by forge tail
    // transforms (post-push); anything else is an admin-custom binding
    // we don't know how to migrate — bail and let the human convert.
    const offenders = rows.filter(
      (r) =>
        r.outputMap !== null &&
        r.outputMap !== undefined &&
        !KNOWN_RELIC_SCENES.has(r.sceneKey),
    );
    if (offenders.length > 0) {
      console.error(
        "[migrate-drop-outputmap] ABORT — these SceneBindings have non-null outputMap that we don't know how to migrate automatically:",
      );
      for (const o of offenders) {
        console.error(`  ${o.sceneKey} → ${JSON.stringify(o.outputMap)}`);
      }
      console.error(
        "Convert them manually: add a tail `transform` node on the bound agent's pipelineConfig that produces the same shape, then null the outputMap on the binding before re-running this migration.",
      );
      process.exit(1);
    }

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "SceneBinding" DROP COLUMN IF EXISTS "outputMap"`,
    );
    console.log("[migrate-drop-outputmap] dropped SceneBinding.outputMap column");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-drop-outputmap] failed:", e);
  process.exit(1);
});
