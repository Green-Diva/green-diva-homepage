// 2026-05-18: Force-refresh `gemini-lore-en` / `gemini-lore-zh` skills'
// `handlerConfig.systemPrompt` to the latest DEFAULT_LORE_*_PROMPT constants.
//
// Reason: prompts were rewritten to fix the lore part (3) "echo in sanctum"
// always collapsing into liturgical clichés (e.g. 「于此圣堂…乱世倾颓…
// 共作遗韵」). The previous migrate-lore-forge.ts deliberately preserves
// admin edits to handlerConfig, so changing the constants alone doesn't
// reach the DB. This script only overwrites the `systemPrompt` key and
// leaves the rest of handlerConfig (model, temperature, authEnv, grounding,
// userTemplate, etc.) untouched.
//
// Idempotent: replays as a no-op if systemPrompt already matches the constant.

import { PrismaClient } from "@prisma/client";
import { DEFAULT_LORE_EN_PROMPT, DEFAULT_LORE_ZH_PROMPT } from "../lib/skills/relic-prompts";

const TARGETS: Array<{ slug: string; prompt: string }> = [
  { slug: "gemini-lore-en", prompt: DEFAULT_LORE_EN_PROMPT },
  { slug: "gemini-lore-zh", prompt: DEFAULT_LORE_ZH_PROMPT },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Skill') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-lore-prompt-v2] Skill table absent — skip");
      return;
    }

    for (const { slug, prompt } of TARGETS) {
      const row = await prisma.skill.findUnique({
        where: { slug },
        select: { id: true, handlerConfig: true },
      });
      if (!row) {
        console.log(`[migrate-lore-prompt-v2] skill "${slug}" not found — skip (run migrate-lore-forge first)`);
        continue;
      }
      const cfg = (row.handlerConfig ?? {}) as Record<string, unknown>;
      if (cfg.systemPrompt === prompt) {
        console.log(`[migrate-lore-prompt-v2] "${slug}" already at v2 — no-op`);
        continue;
      }
      await prisma.skill.update({
        where: { id: row.id },
        data: { handlerConfig: { ...cfg, systemPrompt: prompt } },
      });
      console.log(`[migrate-lore-prompt-v2] "${slug}" systemPrompt refreshed`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[migrate-lore-prompt-v2] failed:", err);
  process.exit(1);
});
