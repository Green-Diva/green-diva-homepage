// Drops Agent.classification — a free-text label that was never wired to a UI
// input and is being removed entirely. Idempotent. Per CLAUDE.md "Prisma db
// push" guidance.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[migrate-remove-classification] start");
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Agent" DROP COLUMN IF EXISTS "classification"`,
  );
  console.log("[migrate-remove-classification] done");
}

main()
  .catch((e) => {
    console.error("[migrate-remove-classification] FAILED", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
