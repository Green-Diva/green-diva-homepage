/**
 * Migrate Cleric.skills JSON field to relational Skill + ClericSkillEquip tables.
 *
 * Usage:
 *   node scripts/migrate-skills-to-relational.mjs
 *
 * Safe to re-run: uses upsert for both Skill and ClericSkillEquip.
 * Does NOT clear Cleric.skills JSON — nullify manually after verifying.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const clerics = await prisma.cleric.findMany({
    select: { id: true, codename: true, skills: true },
  });

  // de-duplicate by nameEn + icon + kind + level (skills with same identity share one row)
  const skillMap = new Map(); // key -> Skill

  let skillsCreated = 0;
  let equipsCreated = 0;

  for (const cleric of clerics) {
    if (!Array.isArray(cleric.skills) || cleric.skills.length === 0) continue;

    for (const s of cleric.skills) {
      const key = `${s.nameEn}||${s.icon}||${s.kind}||${s.level}`;

      if (!skillMap.has(key)) {
        // find existing or create
        let existing = await prisma.skill.findFirst({
          where: {
            nameEn: s.nameEn,
            icon: s.icon,
            kind: s.kind,
            level: s.level,
          },
        });

        if (!existing) {
          existing = await prisma.skill.create({
            data: {
              level: s.level ?? 1,
              icon: s.icon ?? "psychology",
              nameEn: s.nameEn ?? "",
              nameZh: s.nameZh ?? "",
              kind: s.kind ?? "PASSIVE",
              costAp: s.costAp ?? 0,
              descriptionEn: s.descriptionEn ?? "",
              descriptionZh: s.descriptionZh ?? "",
            },
          });
          skillsCreated++;
          console.log(`  [new skill] ${existing.nameEn} (LV.${existing.level} ${existing.kind})`);
        }

        skillMap.set(key, existing);
      }

      const skill = skillMap.get(key);

      // upsert ClericSkillEquip
      const result = await prisma.clericSkillEquip.upsert({
        where: { clericId_skillId: { clericId: cleric.id, skillId: skill.id } },
        create: { clericId: cleric.id, skillId: skill.id, unlocked: s.unlocked ?? false },
        update: { unlocked: s.unlocked ?? false },
      });

      if (result) equipsCreated++;
    }

    console.log(`[${cleric.codename}] migrated ${cleric.skills.length} skill(s)`);
  }

  console.log(`\nDone.`);
  console.log(`  Unique Skill rows created: ${skillsCreated}`);
  console.log(`  ClericSkillEquip records upserted: ${equipsCreated}`);
  console.log(`\nNote: Cleric.skills JSON field has NOT been cleared.`);
  console.log(`To nullify after verification: UPDATE "Cleric" SET skills = NULL;`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
