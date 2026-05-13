// One-shot pre-push migration: drops Relic.formKind + Relic.formReason
// columns and the RelicFormKind enum. Form classification was used to
// pick a default tab on the relic detail page; AssetTabs falls back to
// "enhanced > model3d > original" without it.
//
// Safety: dumps current non-null values before destruction; idempotent.

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Relic') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-drop-form-classification] Relic table absent — skip");
      return;
    }

    const formKindExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'Relic' AND column_name = 'formKind'
       ) AS exists`,
    );
    const formReasonExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'Relic' AND column_name = 'formReason'
       ) AS exists`,
    );

    if (!formKindExists[0]?.exists && !formReasonExists[0]?.exists) {
      console.log("[migrate-drop-form-classification] columns already dropped — no-op");
    } else {
      if (formKindExists[0]?.exists || formReasonExists[0]?.exists) {
        const rows = await prisma.$queryRawUnsafe<
          { id: string; slug: string; formKind: string | null; formReason: string | null }[]
        >(
          `SELECT id, slug,
            ${formKindExists[0]?.exists ? `"formKind"` : `NULL AS "formKind"`},
            ${formReasonExists[0]?.exists ? `"formReason"` : `NULL AS "formReason"`}
           FROM "Relic"
           WHERE ${formKindExists[0]?.exists ? `"formKind" IS NOT NULL` : "FALSE"}
              OR ${formReasonExists[0]?.exists ? `"formReason" IS NOT NULL` : "FALSE"}`,
        );
        console.log(`[migrate-drop-form-classification] dumping ${rows.length} row(s) with non-null form classification:`);
        for (const r of rows) {
          console.log(`  ${r.slug} (${r.id}) → formKind=${r.formKind}, formReason=${JSON.stringify(r.formReason)}`);
        }
      }
      await prisma.$executeRawUnsafe(`ALTER TABLE "Relic" DROP COLUMN IF EXISTS "formKind"`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Relic" DROP COLUMN IF EXISTS "formReason"`);
      console.log("[migrate-drop-form-classification] dropped formKind + formReason columns");
    }

    const enumExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RelicFormKind') AS exists`,
    );
    if (enumExists[0]?.exists) {
      await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "RelicFormKind"`);
      console.log("[migrate-drop-form-classification] dropped RelicFormKind enum");
    } else {
      console.log("[migrate-drop-form-classification] RelicFormKind enum already absent");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-drop-form-classification] failed:", e);
  process.exit(1);
});
