// Backfill Agent.displayOrder with a stable 0..N-1 sequence.
//
// Why: the new admin-controlled roster order lives in Agent.displayOrder.
// Existing rows default to 0 (Prisma column default). When multiple rows
// share displayOrder (the initial all-zero state or a new row appended
// after admin has already reordered), Postgres has no deterministic order
// for them, so the roster looks random.
//
// What this does:
//   1. Look at all Agent rows.
//   2. If the set of displayOrder values has duplicates → renumber every
//      row to 0..N-1, sorted first by the existing displayOrder, then by
//      historical fallback (serial asc nulls last, createdAt asc). This
//      preserves admin's prior ordering while fixing collisions.
//   3. If displayOrder values are already a unique set → skip (idempotent).

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Agent') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-agent-display-order] Agent table absent — skip");
      return;
    }

    const colExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'Agent' AND column_name = 'displayOrder'
       ) AS exists`,
    );
    if (!colExists[0]?.exists) {
      console.log("[migrate-agent-display-order] displayOrder column absent — skip (run db push first)");
      return;
    }

    const agents = await prisma.agent.findMany({
      select: { id: true, codename: true, displayOrder: true, serial: true, createdAt: true },
      orderBy: [
        { displayOrder: "asc" },
        { serial: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
    });

    if (agents.length === 0) {
      console.log("[migrate-agent-display-order] no agents — skip");
      return;
    }

    const distinct = new Set(agents.map((a) => a.displayOrder));
    if (distinct.size === agents.length) {
      console.log("[migrate-agent-display-order] already unique — skip");
      return;
    }

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (a.displayOrder === i) continue;
      await prisma.agent.update({ where: { id: a.id }, data: { displayOrder: i } });
      console.log(`[migrate-agent-display-order] ${a.codename} → ${i}`);
    }
    console.log(`[migrate-agent-display-order] done — normalized to 0..${agents.length - 1}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-agent-display-order] failed:", e);
  process.exit(1);
});
