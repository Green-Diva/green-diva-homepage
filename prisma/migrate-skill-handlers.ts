// One-shot migration: when Skill.handlerKind column is added (Phase 1 of
// the handler system), force every existing skill to OFFLINE so the admin
// re-validates handlerConfig + schemas before re-onlining. Existing rows
// have no real handler attached — they'd be unsafe to leave as ONLINE
// while still rendering as glowing/equipped in the loadout UI.
//
// Idempotent: detected via Skill.handlerKind column existence. Once db push
// has added the column, this script no-ops on subsequent runs.
//
// Required env: DATABASE_URL.
// Runs before `prisma db push` in start command.

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    // Detect "Phase 1 handler columns already added" — this used to check
    // for `handlerKind`, but after the 2026-05-10 collapse that column is
    // renamed to `kind`. handlerConfig was added in the same phase and is
    // unaffected by the rename, so use it as the marker.
    const exists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'Skill' AND column_name = 'handlerConfig'
       ) AS exists`,
    );
    if (exists[0]?.exists) {
      console.log("[migrate-skill-handlers] handler columns already present — skip");
      return;
    }
    console.log("[migrate-skill-handlers] handler columns absent — running first-time backfill");

    // Skill table may not exist yet on a brand-new DB; in that case
    // there are no rows to update and db push will create it cleanly.
    const skillTable = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_name = 'Skill'
       ) AS exists`,
    );
    if (!skillTable[0]?.exists) {
      console.log("[migrate-skill-handlers] Skill table absent (fresh DB) — nothing to backfill");
      return;
    }

    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "Skill" SET "status" = 'OFFLINE' WHERE "status" = 'ONLINE'`,
    );
    console.log(`[migrate-skill-handlers] marked ${updated} existing skill(s) OFFLINE`);

    console.log("[migrate-skill-handlers] done — db push will add handlerKind/handlerConfig/schema columns next");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-skill-handlers] failed:", e);
  process.exit(1);
});
