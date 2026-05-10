// migrate-drop-internal — retire the INTERNAL Skill.kind enum value
// entirely (2026-05-11).
//
// The INTERNAL handler was the runtime injection point for in-repo
// functions; the last user (relic-smart-image-pick) was retired in
// favour of the PICKER-FORGE-001 backbone DAG. With no remaining
// callers, the enum value, the dispatcher, and the seed placeholders
// all come down together.
//
// Order of operations (each step idempotent):
//   1. Convert any seed-placeholder Skill rows still on kind=INTERNAL
//      to MCP_SERVER (the other placeholder kind; runtime is a stub).
//      Their handlerConfig has nothing to invoke anyway — they're
//      decorative roster fillers.
//   2. Drop relic-smart-image-pick Skill row + dangling equips. This is
//      defence-in-depth — Phase 8.5 already stripped the LORE-FORGE
//      slot 4 equip; this catches stragglers in legacy environments.
//   3. Switch the Skill.kind column default away from INTERNAL so the
//      next `db push` doesn't reintroduce it.
//   4. Recreate the SkillKind enum without INTERNAL (Postgres can't
//      DROP VALUE in place, so we ALTER TYPE RENAME old, CREATE new,
//      ALTER COLUMN TYPE, DROP TYPE old).
//
// Runs BEFORE db push in the npm start chain — once the enum is
// rebuilt, the schema's enum definition matches and `db push` is a
// no-op for SkillKind. (Schema file also drops INTERNAL from its enum
// list as a hygiene measure.)

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    // Bail early if the enum doesn't have INTERNAL — re-runs are no-op.
    const hasInternal = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'SkillKind' AND e.enumlabel = 'INTERNAL'
       ) AS exists`,
    );
    if (!hasInternal[0]?.exists) {
      console.log("[migrate-drop-internal] INTERNAL enum value already absent — nothing to do");
      return;
    }

    // 1. Convert seed-placeholder rows. We treat any row with
    //    handlerConfig.handler unset (i.e. not a real internal handler)
    //    as "decorative" and flip to MCP_SERVER. The picker handler row
    //    is dropped separately in step 2.
    const reassigned = await prisma.$executeRawUnsafe(
      `UPDATE "Skill"
         SET "kind" = 'MCP_SERVER'::"SkillKind"
         WHERE "kind" = 'INTERNAL'::"SkillKind"
           AND COALESCE(("handlerConfig"->>'handler'), '') NOT IN ('relic-smart-image-pick')`,
    );
    if (reassigned > 0) {
      console.log(`[migrate-drop-internal] reassigned ${reassigned} placeholder Skill row(s) INTERNAL → MCP_SERVER`);
    }

    // 2. Drop picker INTERNAL row + dangling equips.
    const pickerRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Skill"
        WHERE "kind" = 'INTERNAL'::"SkillKind"
          AND ("handlerConfig"->>'handler') = 'relic-smart-image-pick'`,
    );
    if (pickerRows.length > 0) {
      const ids = pickerRows.map((r) => r.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
      await prisma.$executeRawUnsafe(
        `DELETE FROM "AgentSkillEquip" WHERE "skillId" IN (${placeholders})`,
        ...ids,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "Skill" WHERE "id" IN (${placeholders})`,
        ...ids,
      );
      console.log(`[migrate-drop-internal] removed ${pickerRows.length} relic-smart-image-pick Skill row(s) + equips`);
    }

    // After steps 1+2, no Skill row should still be on INTERNAL. Verify
    // — if any remain, refuse to drop the enum (would lose data).
    const remaining = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "Skill" WHERE "kind" = 'INTERNAL'::"SkillKind"`,
    );
    const remainingCount = Number(remaining[0]?.count ?? BigInt(0));
    if (remainingCount > 0) {
      throw new Error(
        `[migrate-drop-internal] ${remainingCount} Skill row(s) still kind=INTERNAL after reassign — refusing to drop enum value`,
      );
    }

    // 3. Switch the column default away from INTERNAL. db push won't
    //    rewrite this if it matches the schema; we set it to MCP_SERVER
    //    to match the new schema default.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Skill" ALTER COLUMN "kind" SET DEFAULT 'MCP_SERVER'::"SkillKind"`,
    );
    console.log("[migrate-drop-internal] Skill.kind default set to MCP_SERVER");

    // 4. Recreate the enum without INTERNAL. Postgres's lack of
    //    DROP VALUE forces the rename-create-alter-drop dance.
    await prisma.$executeRawUnsafe(`ALTER TYPE "SkillKind" RENAME TO "SkillKind__old"`);
    await prisma.$executeRawUnsafe(
      `CREATE TYPE "SkillKind" AS ENUM ('HTTP_API', 'LLM_PROMPT', 'MCP_SERVER')`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Skill"
         ALTER COLUMN "kind" DROP DEFAULT,
         ALTER COLUMN "kind" TYPE "SkillKind" USING "kind"::text::"SkillKind",
         ALTER COLUMN "kind" SET DEFAULT 'MCP_SERVER'::"SkillKind"`,
    );
    await prisma.$executeRawUnsafe(`DROP TYPE "SkillKind__old"`);
    console.log("[migrate-drop-internal] dropped INTERNAL from SkillKind enum");
    console.log("[migrate-drop-internal] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-drop-internal] failed:", e);
  process.exit(1);
});
