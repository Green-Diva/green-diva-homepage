// migrate-cleanup-io-primitives — drop the 3 IO primitive INTERNAL Skill
// rows that no longer have a registered handler. They were briefly
// added as admin-equippable building blocks then removed because no
// active forge agent equips them and the same IO work is done in the
// pipeline / endpoint layer (lib/relics/pipeline/scanWorkspace.ts +
// lib/relics/readImageAsDataUri.ts).
//
//   - image-to-data-uri-relic       (incl. -imp-1 import-rename copy)
//   - private-dir-scan
//   - relic-fetch-draft-note
//
// Idempotent — re-running finds nothing and exits clean.
// Defence-in-depth: cleans dangling AgentSkillEquip rows first.

import { PrismaClient } from "@prisma/client";

const DEPRECATED_SLUGS = [
  "image-to-data-uri-relic",
  "image-to-data-uri-relic-imp-1",
  "private-dir-scan",
  "relic-fetch-draft-note",
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const skills = await prisma.skill.findMany({
      where: { slug: { in: DEPRECATED_SLUGS } },
      select: { id: true, slug: true },
    });
    if (skills.length === 0) {
      console.log("[migrate-cleanup-io-primitives] no deprecated rows present — nothing to do");
      return;
    }

    const skillIds = skills.map((s) => s.id);

    const danglingEquips = await prisma.agentSkillEquip.deleteMany({
      where: { skillId: { in: skillIds } },
    });
    if (danglingEquips.count > 0) {
      console.log(
        `[migrate-cleanup-io-primitives] removed ${danglingEquips.count} dangling AgentSkillEquip row(s)`,
      );
    }

    const deleted = await prisma.skill.deleteMany({
      where: { id: { in: skillIds } },
    });
    for (const s of skills) {
      console.log(`[migrate-cleanup-io-primitives] deleted Skill "${s.slug}" (${s.id})`);
    }
    console.log(`[migrate-cleanup-io-primitives] deleted ${deleted.count} Skill row(s) total`);
    console.log("[migrate-cleanup-io-primitives] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-cleanup-io-primitives] fatal", e);
  process.exit(1);
});
