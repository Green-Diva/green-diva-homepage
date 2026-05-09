// Drops Relic.origin and Relic.acquiredAt — the "ACQUIRED / ORIGIN" detail
// strip was removed from the UI; both columns are now unused. Idempotent.
// Per CLAUDE.md "Prisma db push" guidance.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[migrate-remove-relic-origin-acquired] start");
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Relic" DROP COLUMN IF EXISTS "origin"`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Relic" DROP COLUMN IF EXISTS "acquiredAt"`,
  );
  console.log("[migrate-remove-relic-origin-acquired] done");
}

main()
  .catch((e) => {
    console.error("[migrate-remove-relic-origin-acquired] FAILED", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
