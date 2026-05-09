// One-shot migration: introduces the RelicDraft table and RelicDraftStatus
// enum. The new "upload → preview → confirm" flow stages AI-generated
// metadata in RelicDraft until the admin commits. No real Relic row exists
// during the draft phase; on confirm a Relic is created and the workspace
// directory is renamed. See app/relic-collection/_components/RelicDraftPanel
// and lib/relics/pipeline/draftPipeline for the flow.
//
// db push on its own creates new tables/enums cleanly, so this script is
// mostly a hook for future draft-related backfills (e.g. cleaning up
// abandoned workspaces). It logs schema state but performs no row changes.
//
// Idempotent: safe to run repeatedly. Required env: DATABASE_URL.

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_name = 'RelicDraft'
       ) AS exists`,
    );
    if (tableExists[0]?.exists) {
      console.log("[migrate-relic-drafts] RelicDraft table present — no-op");
    } else {
      console.log("[migrate-relic-drafts] RelicDraft table absent — db push will create it next");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-relic-drafts] failed:", e);
  process.exit(1);
});
