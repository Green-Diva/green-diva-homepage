// One-shot migration: backfill Skill.slug for rows created before the
// column existed. slug is the stable LLM tool name + future admin URL key,
// derived from nameEn (lowercase, kebab-case) with a short id suffix on
// uniqueness collisions.
//
// Idempotent: skips when the column doesn't exist yet (db push hasn't run
// the schema diff) and when no NULL rows remain. Runs both before and
// after `prisma db push` in the start command — the first pass no-ops on
// fresh DBs (column absent), the second pass fills the new column.
//
// Required env: DATABASE_URL.

import { PrismaClient } from "@prisma/client";

function deriveSlug(nameEn: string): string {
  const base = nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return base || "skill";
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const colExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'Skill' AND column_name = 'slug'
       ) AS exists`,
    );
    if (!colExists[0]?.exists) {
      console.log("[migrate-skill-slug] slug column absent — skip (db push will add it; backfill on next start)");
      return;
    }

    const rows = await prisma.$queryRawUnsafe<{ id: string; nameEn: string }[]>(
      `SELECT id, "nameEn" FROM "Skill" WHERE slug IS NULL`,
    );
    if (rows.length === 0) {
      console.log("[migrate-skill-slug] no NULL slug rows — skip");
      return;
    }
    console.log(`[migrate-skill-slug] backfilling ${rows.length} skill(s)`);

    // Pull existing slugs so we can avoid collisions on derive.
    const taken = new Set<string>();
    const existing = await prisma.$queryRawUnsafe<{ slug: string }[]>(
      `SELECT slug FROM "Skill" WHERE slug IS NOT NULL`,
    );
    for (const r of existing) taken.add(r.slug);

    for (const row of rows) {
      const base = deriveSlug(row.nameEn);
      let candidate = base;
      let attempt = 0;
      while (taken.has(candidate)) {
        attempt += 1;
        const suffix = row.id.slice(-Math.min(6, 4 + attempt));
        candidate = `${base}-${suffix}`.slice(0, 64);
        if (attempt > 10) {
          // Pathological — pick a random suffix from the cuid tail.
          candidate = `${base.slice(0, 50)}-${row.id.slice(-8)}`;
          break;
        }
      }
      taken.add(candidate);
      await prisma.$executeRawUnsafe(
        `UPDATE "Skill" SET slug = $1 WHERE id = $2`,
        candidate,
        row.id,
      );
      console.log(`[migrate-skill-slug] ${row.id} → ${candidate}`);
    }

    console.log("[migrate-skill-slug] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-skill-slug] failed:", e);
  process.exit(1);
});
