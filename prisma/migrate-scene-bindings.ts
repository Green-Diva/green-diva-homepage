// One-shot migration: post-push backfill for the agent-service framework.
//
// db push handles schema (Agent.capabilities column + SceneBinding table).
// This script does the data-side things db push can't:
//   1. Seed RELIC-SCRIBE-001's capability tags so it surfaces as a binding
//      candidate in /agent-control?tab=scenes.
//   2. Seed default SceneBinding rows for the four relic.* scenes so the
//      pipeline / endpoints can dispatch immediately on first deploy
//      (otherwise they'd hit UNBOUND_SCENE 503 until admin clicked
//      around).
//
// Idempotent: capability backfill skips when the column / agent is absent
// or the field is already populated. Default binding seed creates rows
// only when a binding for the sceneKey doesn't yet exist — admin edits
// (different agent, customized inputMap) survive re-runs untouched.
//
// Required env: DATABASE_URL.

import { PrismaClient } from "@prisma/client";

const SCRIBE_CODENAME = "RELIC-SCRIBE-001";
// Initial seed only — admin can edit these in /agent-control later.
// Tags are free-form strings; conventional vocabulary is "<verb>-<noun>".
const SCRIBE_CAPABILITIES = [
  "lore-writing",
  "metadata-derivation",
  "image-pick",
  "image-cutout",
  "model-3d-generation",
];

// Default bindings for the four relic.* scenes. 2026-05-12 — inputMap
// retired; ctx → agent.input shaping is owned by scene.prepareAgentInput
// in lib/relics/scenes.ts. Admin edits agent / enabled / notes in
// /agent-control?tab=scenes; this seed only fires when the row is absent
// (per-row existence check).
type DefaultBinding = {
  sceneKey: string;
  notes: string;
};

const DEFAULT_BINDINGS: DefaultBinding[] = [
  {
    sceneKey: "relic.generate-draft-metadata",
    notes:
      "Default seed: routes draft pipeline GENERATE_METADATA to RELIC-SCRIBE-001.",
  },
  {
    sceneKey: "relic.regen-metadata",
    notes:
      "Default seed: routes admin '🔄 重新生成' button to RELIC-SCRIBE-001.",
  },
  {
    sceneKey: "relic.enhance2d",
    notes:
      "Default seed: routes detail-page 2D enhance tab to RELIC-SCRIBE-001.",
  },
  {
    sceneKey: "relic.create3d",
    notes:
      "Default seed: routes detail-page 3D create tab to RELIC-SCRIBE-001.",
  },
];

async function seedCapabilities(prisma: PrismaClient): Promise<void> {
  const colExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'Agent' AND column_name = 'capabilities'
     ) AS exists`,
  );
  if (!colExists[0]?.exists) {
    console.log("[migrate-scene-bindings] capabilities column absent — skip (db push will add it; backfill next start)");
    return;
  }

  const arrayLiteral = `{${SCRIBE_CAPABILITIES.map((c) => `"${c}"`).join(",")}}`;
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "Agent"
        SET capabilities = $1::text[]
      WHERE codename = $2
        AND (cardinality(capabilities) = 0 OR capabilities IS NULL)`,
    arrayLiteral,
    SCRIBE_CODENAME,
  );
  if (updated > 0) {
    console.log(`[migrate-scene-bindings] seeded capabilities for ${SCRIBE_CODENAME}: [${SCRIBE_CAPABILITIES.join(", ")}]`);
  } else {
    console.log("[migrate-scene-bindings] capability backfill: not needed (already set or agent missing)");
  }
}

async function seedDefaultBindings(prisma: PrismaClient): Promise<void> {
  const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_name = 'SceneBinding'
     ) AS exists`,
  );
  if (!tableExists[0]?.exists) {
    console.log("[migrate-scene-bindings] SceneBinding table absent — skip default seed");
    return;
  }

  const scribe = await prisma.agent.findUnique({
    where: { codename: SCRIBE_CODENAME },
    select: { id: true },
  });
  if (!scribe) {
    console.log("[migrate-scene-bindings] RELIC-SCRIBE-001 missing — skip default seed");
    return;
  }

  let created = 0;
  let preserved = 0;
  for (const def of DEFAULT_BINDINGS) {
    const existing = await prisma.sceneBinding.findUnique({
      where: { sceneKey: def.sceneKey },
      select: { id: true },
    });
    if (existing) {
      preserved += 1;
      continue;
    }
    await prisma.sceneBinding.create({
      data: {
        sceneKey: def.sceneKey,
        agentId: scribe.id,
        notes: def.notes,
      },
    });
    created += 1;
    console.log(`[migrate-scene-bindings] created default binding: ${def.sceneKey} → ${SCRIBE_CODENAME}`);
  }
  console.log(`[migrate-scene-bindings] default bindings: ${created} created, ${preserved} preserved`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedCapabilities(prisma);
    await seedDefaultBindings(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-scene-bindings] failed:", e);
  process.exit(1);
});
