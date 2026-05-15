// Idempotent pre-push migration: rename AgentStatus enum value `ONLINE` →
// `DEPLOYED`. Postgres `ALTER TYPE ... RENAME VALUE` is a single DDL — it
// updates the enum label in place; existing rows holding the old label
// automatically read out as the new one (the on-disk OID is unchanged).
//
// Why pre-push: `prisma db push` reconciles schema enums by DROP/CREATE
// when it sees a value rename, which would fail under `--accept-data-loss`
// guard because Agent rows reference the old value. Running this script
// first means by the time `db push` runs, the enum already matches schema.
//
// Idempotent: checks `pg_enum` for the new label; if present, no-op.

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
      `SELECT e.enumlabel
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'AgentStatus'`,
    );
    const labels = new Set(rows.map((r) => r.enumlabel));

    if (labels.has("DEPLOYED")) {
      console.log("[migrate-rename-agent-status] DEPLOYED already present — skipping");
      return;
    }
    if (!labels.has("ONLINE")) {
      // Fresh DB without the enum yet (db push will create it). No-op.
      console.log("[migrate-rename-agent-status] AgentStatus enum not found — skipping");
      return;
    }

    await prisma.$executeRawUnsafe(`ALTER TYPE "AgentStatus" RENAME VALUE 'ONLINE' TO 'DEPLOYED'`);
    console.log("[migrate-rename-agent-status] renamed ONLINE → DEPLOYED");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[migrate-rename-agent-status] failed", err);
  process.exit(1);
});
