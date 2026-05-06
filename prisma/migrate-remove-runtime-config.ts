// One-shot, idempotent migration to drop the runtime-config columns from
// "Agent". `prisma db push` refuses destructive ops without
// --accept-data-loss; we'd rather do it explicitly here so production
// migrations stay traceable. Per CLAUDE.md "Prisma db push" guidance.
//
// Drops: enabled, provider, model, systemPrompt, internalHandler,
// inputSchemaJson, outputSchemaJson, maxTokens, temperature, rateLimitPerMin
// Plus the (enabled, provider) composite index and the AgentProvider enum.
//
// Safe to re-run: every step uses IF EXISTS.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DROP_COLUMNS = [
  "enabled",
  "provider",
  "model",
  "systemPrompt",
  "internalHandler",
  "inputSchemaJson",
  "outputSchemaJson",
  "maxTokens",
  "temperature",
  "rateLimitPerMin",
] as const;

async function main() {
  console.log("[migrate-remove-runtime-config] start");

  // Drop composite index first — safe because it depends on columns we'll drop.
  await prisma.$executeRawUnsafe(
    `DROP INDEX IF EXISTS "Agent_enabled_provider_idx"`,
  );

  for (const col of DROP_COLUMNS) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Agent" DROP COLUMN IF EXISTS "${col}"`,
    );
    console.log(`  · dropped column ${col}`);
  }

  // Enum is referenced only by the now-dropped "provider" column.
  await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "AgentProvider"`);

  // Add Chinese codename column (nullable) — separate from nameZh which is the
  // role description.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "codenameZh" TEXT`,
  );

  console.log("[migrate-remove-runtime-config] done");
}

main()
  .catch((e) => {
    console.error("[migrate-remove-runtime-config] FAILED", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
