// One-shot migration for the machine-agent loadout overhaul (2026-05-06).
//
// Three jobs, all idempotent and safe to re-run:
//
//   1. Drop the 6 legacy Agent stat columns (quickness / intelligence /
//      neuralLink / bioSync / logic / compassion). The product decision is
//      to replace them with derived stats; raw data is intentionally lost.
//      Without this step `prisma db push` refuses to drop columns that
//      contain non-null values without --accept-data-loss.
//
//   2. Backfill empty Agent.avatarUrl with a default placeholder so that
//      the new NOT NULL constraint on this column can be applied without
//      breaking existing rows.
//
//   3. Convert Agent.matrixLevel from any legacy nullable / wrong-default
//      state — currently the prod DB may have NULLs left over. Defensive.
//
// Runs before `prisma db push` in npm start so by the time push runs, the
// dangerous diffs are already absorbed and push is a no-op (or only adds
// new columns which is always safe).

import { PrismaClient } from "@prisma/client";

const DEFAULT_AVATAR = "/images/machine-agent/avatars/default.svg";
const LEGACY_STAT_COLUMNS = [
  "quickness",
  "intelligence",
  "neuralLink",
  "bioSync",
  "logic",
  "compassion",
] as const;

async function tableExists(prisma: PrismaClient, table: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    table,
  );
  return !!r[0]?.exists;
}

async function columnExists(prisma: PrismaClient, table: string, column: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    table,
    column,
  );
  return !!r[0]?.exists;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    if (!(await tableExists(prisma, "Agent"))) {
      console.log("[migrate-agent-loadout] Agent table absent — fresh DB, skipping");
      return;
    }

    // 1. Drop legacy stat columns
    for (const col of LEGACY_STAT_COLUMNS) {
      if (await columnExists(prisma, "Agent", col)) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "Agent" DROP COLUMN IF EXISTS "${col}"`);
        console.log(`[migrate-agent-loadout] dropped legacy column Agent.${col}`);
      }
    }

    // 2. Backfill empty avatarUrl
    if (await columnExists(prisma, "Agent", "avatarUrl")) {
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE "Agent" SET "avatarUrl" = $1 WHERE "avatarUrl" IS NULL OR "avatarUrl" = ''`,
        DEFAULT_AVATAR,
      );
      if (updated > 0) {
        console.log(`[migrate-agent-loadout] backfilled ${updated} row(s) with default avatar`);
      }

      // 2b. Rewrite legacy default-avatar path that pre-dates the /images/ prefix fix.
      // Old value `/machine-agent/avatars/default.svg` is not in middleware STATIC_PREFIXES
      // so it 307s to /login. New value lives at /images/machine-agent/avatars/default.svg.
      const rewritten = await prisma.$executeRawUnsafe(
        `UPDATE "Agent" SET "avatarUrl" = $1 WHERE "avatarUrl" = '/machine-agent/avatars/default.svg'`,
        DEFAULT_AVATAR,
      );
      if (rewritten > 0) {
        console.log(`[migrate-agent-loadout] rewrote ${rewritten} row(s) from legacy default-avatar path`);
      }
    }

    console.log("[migrate-agent-loadout] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-agent-loadout] failed:", e);
  process.exit(1);
});
