// One-shot pre-push migration (2026-05-10): collapse the two `Skill` enums
// into one. The decorative `kind` column (PASSIVE/ACTIVE/ULTIMATE) is dropped,
// and the load-bearing `handlerKind` column (HTTP_API/LLM_PROMPT/...) is
// renamed to `kind` while its enum is renamed `HandlerKind` → `SkillKind`.
//
// Idempotent: detects state by inspecting the live column / type names. After
// the schema diff has fully landed (i.e. handlerKind column gone, kind column
// is the SkillKind enum), every step short-circuits.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2
     ) as exists`,
    table,
    column,
  );
  return rows[0]?.exists === true;
}

async function typeExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = $1) as exists`,
    name,
  );
  return rows[0]?.exists === true;
}

async function main() {
  const hasOldKind = await columnExists("Skill", "kind");
  const hasHandlerKind = await columnExists("Skill", "handlerKind");
  const hasOldEnum = await typeExists("SkillKind");
  const hasHandlerEnum = await typeExists("HandlerKind");

  // Detect "already migrated": kind column exists but is not the legacy enum.
  // We approximate by: handlerKind gone AND old SkillKind enum gone (meaning
  // SkillKind name now refers to the renamed handler enum).
  if (!hasHandlerKind && !hasHandlerEnum && hasOldKind && !await isLegacyKindEnum()) {
    console.log("[migrate-skill-kind-rename] already in target state — skip");
    return;
  }

  console.log("[migrate-skill-kind-rename] starting collapse");

  // Step 1 — drop decorative kind column (loses PASSIVE/ACTIVE/ULTIMATE data,
  // which had zero runtime semantics).
  if (hasOldKind && await isLegacyKindEnum()) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Skill" DROP COLUMN IF EXISTS "kind"`);
    console.log("[migrate-skill-kind-rename] dropped decorative Skill.kind column");
  }

  // Step 2 — drop the now-unreferenced legacy SkillKind enum so the name is
  // free for the rename in step 3.
  if (hasOldEnum && await isLegacyKindEnum()) {
    await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "SkillKind"`);
    console.log("[migrate-skill-kind-rename] dropped legacy SkillKind enum");
  }

  // Step 3 — rename HandlerKind enum → SkillKind.
  if (hasHandlerEnum && !(await typeExists("SkillKind"))) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "HandlerKind" RENAME TO "SkillKind"`);
    console.log("[migrate-skill-kind-rename] renamed enum HandlerKind → SkillKind");
  }

  // Step 4 — rename Skill.handlerKind → Skill.kind.
  if (await columnExists("Skill", "handlerKind") && !(await columnExists("Skill", "kind"))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Skill" RENAME COLUMN "handlerKind" TO "kind"`);
    console.log("[migrate-skill-kind-rename] renamed column handlerKind → kind");
  }

  // Step 5 — rename matching index if it carried the old name.
  await prisma.$executeRawUnsafe(
    `ALTER INDEX IF EXISTS "Skill_handlerKind_idx" RENAME TO "Skill_kind_idx"`,
  );

  console.log("[migrate-skill-kind-rename] done");
}

// True when the SkillKind enum still has its decorative values.
async function isLegacyKindEnum(): Promise<boolean> {
  if (!(await typeExists("SkillKind"))) return false;
  const rows = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'SkillKind'`,
  );
  const labels = new Set(rows.map((r) => r.enumlabel));
  return labels.has("PASSIVE") || labels.has("ACTIVE") || labels.has("ULTIMATE");
}

main()
  .catch((e) => {
    console.error("[migrate-skill-kind-rename] FAILED", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
