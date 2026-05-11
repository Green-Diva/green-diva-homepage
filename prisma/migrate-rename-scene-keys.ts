// Rename SceneBinding rows to the verb-first naming convention (2026-05-11).
//
// Only one current scene was a pure noun:
//   relic.draft-metadata  →  relic.generate-draft-metadata
//
// Strategy (idempotent):
//   1. If a row with the OLD key exists AND no row with the NEW key exists,
//      rename the OLD row's sceneKey.
//   2. If both exist (unlikely), keep the NEW row, delete the OLD.
//   3. If only the NEW row exists (already migrated), no-op.
//
// The scene registry has a registerSceneAlias("relic.draft-metadata", ...)
// fallback, so even unmigrated rows resolve correctly at runtime — this
// migration is for DB cleanliness, not correctness.

import { PrismaClient } from "@prisma/client";

const RENAMES: Array<[string, string]> = [
  ["relic.draft-metadata", "relic.generate-draft-metadata"],
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-rename-scene-keys] SceneBinding table absent — skip");
      return;
    }

    for (const [oldKey, newKey] of RENAMES) {
      const oldRow = await prisma.sceneBinding.findUnique({ where: { sceneKey: oldKey } });
      const newRow = await prisma.sceneBinding.findUnique({ where: { sceneKey: newKey } });

      if (!oldRow && !newRow) {
        console.log(`[migrate-rename-scene-keys] neither "${oldKey}" nor "${newKey}" present — skip`);
        continue;
      }
      if (!oldRow && newRow) {
        console.log(`[migrate-rename-scene-keys] "${newKey}" already present (no old row) — skip`);
        continue;
      }
      if (oldRow && newRow) {
        // Both exist — admin must've created the new one manually. Keep
        // new, delete old (sceneKey is @unique, can't have two).
        console.log(`[migrate-rename-scene-keys] both keys present; deleting old "${oldKey}"`);
        await prisma.sceneBinding.delete({ where: { sceneKey: oldKey } });
        continue;
      }
      // oldRow exists, newRow doesn't — rename.
      await prisma.sceneBinding.update({
        where: { sceneKey: oldKey },
        data: { sceneKey: newKey },
      });
      console.log(`[migrate-rename-scene-keys] renamed "${oldKey}" → "${newKey}"`);
    }

    console.log("[migrate-rename-scene-keys] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-rename-scene-keys] failed:", e);
  process.exit(1);
});
