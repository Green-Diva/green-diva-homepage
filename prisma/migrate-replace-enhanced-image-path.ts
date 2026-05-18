// One-shot migration: retire single-string Relic.enhancedImagePath in
// favour of Relic.enhancedImages (Json array, max 16 entries).
//
// Why: the 2D enhance flow grew from "1 primary → 1 enhance" to
// "N candidates → N enhances with per-source params history". The
// runner's writeback hook keys upserts on sourceCandidatePath. Reading
// "the primary enhance" becomes `enhancedImages[0].path`.
//
// Idempotent: bails out once the legacy column is gone.
//
// Runs pre-`prisma db push` in npm start so the schema diff is a no-op
// by the time db push executes (legacy col already DROPPED here, new
// col already ADDed + backfilled here).

import { PrismaClient } from "@prisma/client";

const DEFAULT_MODEL = "General Use (Light)";
const DEFAULT_RESOLUTION = "1024x1024";

async function main() {
  const prisma = new PrismaClient();
  try {
    const legacyExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'Relic' AND column_name = 'enhancedImagePath'
       ) AS exists`,
    );
    if (!legacyExists[0]?.exists) {
      console.log("[migrate-enhanced-images] legacy enhancedImagePath column absent — skip");
      return;
    }
    console.log("[migrate-enhanced-images] legacy column present — migrating");

    // Add the new column up-front. Adding a nullable JSONB column is
    // cheap (no rewrite) and safe to re-run with IF NOT EXISTS.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Relic" ADD COLUMN IF NOT EXISTS "enhancedImages" JSONB`,
    );

    // Backfill: wrap each non-null enhancedImagePath into a single-entry
    // array. sourceCandidatePath = primaryImagePath because that's what
    // the old single-shot flow always enhanced. Other fields use defaults
    // since we don't know what params produced the legacy output.
    const rows = await prisma.$queryRawUnsafe<
      { id: string; enhancedImagePath: string; primaryImagePath: string | null }[]
    >(
      `SELECT id, "enhancedImagePath", "primaryImagePath"
         FROM "Relic"
        WHERE "enhancedImagePath" IS NOT NULL
          AND ("enhancedImages" IS NULL OR jsonb_array_length("enhancedImages") = 0)`,
    );
    console.log(`[migrate-enhanced-images] backfilling ${rows.length} row(s)`);
    const nowIso = new Date().toISOString();
    for (const r of rows) {
      const entry = {
        path: r.enhancedImagePath,
        sourceCandidatePath: r.primaryImagePath ?? r.enhancedImagePath,
        model: DEFAULT_MODEL,
        operatingResolution: DEFAULT_RESOLUTION,
        refineForeground: true,
        createdAt: nowIso,
      };
      await prisma.$executeRawUnsafe(
        `UPDATE "Relic" SET "enhancedImages" = $1::jsonb WHERE id = $2`,
        JSON.stringify([entry]),
        r.id,
      );
    }

    // Drop the legacy column once data is safe in the new shape. After
    // this, schema.prisma matches the live DB → db push is a no-op.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Relic" DROP COLUMN IF EXISTS "enhancedImagePath"`,
    );

    console.log("[migrate-enhanced-images] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-enhanced-images] failed:", e);
  process.exit(1);
});
