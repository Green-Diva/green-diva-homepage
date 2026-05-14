// One-shot pre-push migration: drops Agent.descriptionEn + Agent.descriptionZh
// columns. The description fields were free-form admin notes redundant with
// the codename / nameEn / nameZh / capabilities trio; removing the field
// simplifies the AgentEditor form and the export/import envelope.
//
// Safety: dumps current non-null values before destruction; idempotent.

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Agent') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-drop-agent-description] Agent table absent — skip");
      return;
    }

    const enExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'Agent' AND column_name = 'descriptionEn'
       ) AS exists`,
    );
    const zhExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'Agent' AND column_name = 'descriptionZh'
       ) AS exists`,
    );

    if (!enExists[0]?.exists && !zhExists[0]?.exists) {
      console.log("[migrate-drop-agent-description] columns already dropped — no-op");
      return;
    }

    const rows = await prisma.$queryRawUnsafe<
      { id: string; codename: string; descriptionEn: string | null; descriptionZh: string | null }[]
    >(
      `SELECT id, codename,
         ${enExists[0]?.exists ? `"descriptionEn"` : `NULL AS "descriptionEn"`},
         ${zhExists[0]?.exists ? `"descriptionZh"` : `NULL AS "descriptionZh"`}
       FROM "Agent"
       WHERE ${enExists[0]?.exists ? `"descriptionEn" IS NOT NULL` : "FALSE"}
          OR ${zhExists[0]?.exists ? `"descriptionZh" IS NOT NULL` : "FALSE"}`,
    );
    console.log(`[migrate-drop-agent-description] dumping ${rows.length} row(s) with non-null description:`);
    for (const r of rows) {
      console.log(
        `  ${r.codename} (${r.id}) → descriptionEn=${JSON.stringify(r.descriptionEn)}, descriptionZh=${JSON.stringify(r.descriptionZh)}`,
      );
    }

    await prisma.$executeRawUnsafe(`ALTER TABLE "Agent" DROP COLUMN IF EXISTS "descriptionEn"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Agent" DROP COLUMN IF EXISTS "descriptionZh"`);
    console.log("[migrate-drop-agent-description] dropped descriptionEn + descriptionZh columns");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-drop-agent-description] failed:", e);
  process.exit(1);
});
