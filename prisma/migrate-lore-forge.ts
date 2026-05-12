// Seeds the 3 gemini-* skills used by the bilingual lore + metadata chain.
//
// 2026-05-12: this script USED to also create the LORE-FORGE-001 agent and
// bind it to relic.{generate-draft-metadata,regen-metadata}. Those
// responsibilities moved to migrate-relic-forge.ts when the three forge
// agents were collapsed into a single RELIC-FORGE-001. This script now
// only seeds skill rows; the unified migrate-relic-forge.ts looks them up
// by slug and equips them.
//
// All "context-prep" work (Prisma draftNote read + workspace FS scan +
// listing format) is done at the pipeline layer
// (lib/relics/pipeline/scanWorkspace.ts) BEFORE callScene, and arrives
// via scene.prepareAgentInput → agent.input.{userBrief, fileSummary,
// imageAbsPaths, textExcerpts}.

import { Prisma, PrismaClient } from "@prisma/client";
import {
  DEFAULT_LORE_EN_PROMPT,
  DEFAULT_LORE_ZH_PROMPT,
  DEFAULT_METADATA_PROMPT,
} from "../lib/skills/relic-prompts";

// — — Skill specs — — — — — — — — — — — — — — — — — — — — — — — — — —

const SKILL_LORE_EN = {
  slug: "gemini-lore-en",
  nameEn: "Gemini Lore (EN, grounded)",
  nameZh: "Gemini 圣记（英文 · grounding）",
  icon: "auto_stories",
  descriptionEn:
    "Pass 1 of the lore chain. Gemini 2.5 with Google Search grounding + vision; produces ≤110-word English markdown lore from user images + file summary. Prompt admin-editable in handlerConfig.",
  descriptionZh:
    "圣记链第一步。Gemini 2.5 启用 Google Search grounding + 视觉,根据用户图与文件摘要写 ≤110 词英文 markdown 圣记。Prompt 在 handlerConfig 可改。",
  kind: "LLM_PROMPT" as const,
  handlerConfig: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    authEnv: "GEMINI_API_KEY",
    grounding: true,
    imagePathsField: "imageAbsPaths",
    maxTokens: 4096,
    systemPrompt: DEFAULT_LORE_EN_PROMPT,
    userTemplate:
      "User brief:\n{{userBrief}}\n\nFile summary:\n{{fileSummary}}\n\nText excerpts:\n{{textExcerpts}}",
  } as Prisma.InputJsonValue,
  // Drives both invokeSkill input validation and AUTONOMOUS LLM tool schema.
  // Fields mirror userTemplate's {{X}} references + imagePathsField target.
  inputSchema: {
    type: "object",
    properties: {
      userBrief: { type: "string", description: "Admin's free-form description of the relic (from upload modal)." },
      fileSummary: { type: "string", description: "One-line summary of files in the draft workspace." },
      textExcerpts: { type: "string", description: "Excerpts from any text files the user uploaded." },
      imageAbsPaths: {
        type: "array",
        items: { type: "string" },
        description: "Absolute filesystem paths to user-uploaded images. Read by Gemini as vision input.",
      },
    },
    required: ["userBrief"],
  } as Prisma.InputJsonValue,
};

const SKILL_LORE_ZH = {
  slug: "gemini-lore-zh",
  nameEn: "Gemini Lore (ZH, translation)",
  nameZh: "Gemini 圣记（中译）",
  icon: "translate",
  descriptionEn:
    "Pass 2 of the lore chain. Gemini 2.5 (no grounding, no vision) — translates the English lore into a literary ≤140-字 Chinese version, applying the editorial style rules in the prompt.",
  descriptionZh:
    "圣记链第二步。Gemini 2.5(无 grounding、无视觉)—— 把英文圣记意译为 ≤140 字的中文版本,按 prompt 的文风规约削减虚词。",
  kind: "LLM_PROMPT" as const,
  handlerConfig: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    authEnv: "GEMINI_API_KEY",
    grounding: false,
    maxTokens: 4096,
    systemPrompt: DEFAULT_LORE_ZH_PROMPT,
    userTemplate: "{{loreEn}}",
  } as Prisma.InputJsonValue,
  inputSchema: {
    type: "object",
    properties: {
      loreEn: { type: "string", description: "English markdown lore to translate. Should be ≤110 words and contain the relic's narrative." },
    },
    required: ["loreEn"],
  } as Prisma.InputJsonValue,
};

const SKILL_METADATA = {
  slug: "gemini-metadata",
  nameEn: "Gemini Metadata Derive",
  nameZh: "Gemini 元数据派生",
  icon: "psychology",
  descriptionEn:
    "Reads bilingual lore + reference images and emits the 9-field metadata JSON (title/subtitle/icon/rarity/formKind + image-pick decision). Used by both initial and regen modes.",
  descriptionZh:
    "读双语圣记 + 参考图,输出 9 字段元数据 JSON(title/subtitle/icon/rarity/formKind + 选图决策)。initial 与 regen 两种 mode 都用。",
  kind: "LLM_PROMPT" as const,
  handlerConfig: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    authEnv: "GEMINI_API_KEY",
    grounding: false,
    imagePathsField: "imageAbsPaths",
    maxTokens: 8192,
    responseFormat: "json",
    systemPrompt: DEFAULT_METADATA_PROMPT,
    userTemplate:
      "Lore (Chinese):\n{{loreZh}}\n\nLore (English):\n{{loreEn}}\n\n{{feedback}}",
  } as Prisma.InputJsonValue,
  inputSchema: {
    type: "object",
    properties: {
      loreZh: { type: "string", description: "Chinese markdown lore (≤140 字)." },
      loreEn: { type: "string", description: "English markdown lore (≤110 words)." },
      feedback: { type: "string", description: "Optional admin feedback for regen mode — describes what to change. Empty string for initial mode." },
      imageAbsPaths: {
        type: "array",
        items: { type: "string" },
        description: "Absolute paths to reference images. Read by Gemini as vision input.",
      },
    },
    required: ["loreZh", "loreEn"],
  } as Prisma.InputJsonValue,
};

// 2026-05-11: outputMap retired — agent's tail wrap-research transform
//             + metadata-regen leaf produce scene-shape directly.
// 2026-05-12: inputMap retired — ctx → agent.input owned by
//             scene.prepareAgentInput in lib/relics/scenes.ts.
// 2026-05-12: LORE-FORGE-001 agent itself absorbed into RELIC-FORGE-001
//             (see migrate-relic-forge.ts). The DAG that used to be seeded
//             from this file is now declared in that script. Skill specs
//             remain here as the source of truth for the gemini-* tools.

async function ensureSkill(
  prisma: PrismaClient,
  spec: typeof SKILL_LORE_EN | typeof SKILL_LORE_ZH | typeof SKILL_METADATA,
): Promise<string> {
  const existing = await prisma.skill.findUnique({ where: { slug: spec.slug } });
  if (existing) {
    // Heal stale rows: backfill inputSchema (added 2026-05-12 for AUTONOMOUS
    // tool exposure) + refresh nameEn/descriptionEn so SkillLibrary stays in
    // sync with the spec. handlerConfig left alone to preserve admin edits.
    await prisma.skill.update({
      where: { id: existing.id },
      data: {
        nameEn: spec.nameEn,
        nameZh: spec.nameZh,
        descriptionEn: spec.descriptionEn,
        descriptionZh: spec.descriptionZh,
        inputSchema: spec.inputSchema,
      },
    });
    console.log(`[migrate-lore-forge] skill "${spec.slug}" exists (${existing.id}); healed inputSchema + description`);
    return existing.id;
  }
  const created = await prisma.skill.create({
    data: {
      slug: spec.slug,
      nameEn: spec.nameEn,
      nameZh: spec.nameZh,
      icon: spec.icon,
      descriptionEn: spec.descriptionEn,
      descriptionZh: spec.descriptionZh,
      kind: spec.kind,
      handlerConfig: spec.handlerConfig,
      inputSchema: spec.inputSchema,
      status: "ONLINE",
    },
    select: { id: true },
  });
  console.log(`[migrate-lore-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-lore-forge] SceneBinding table absent — skip (run earlier migrations first)");
      return;
    }

    await ensureSkill(prisma, SKILL_LORE_EN);
    await ensureSkill(prisma, SKILL_LORE_ZH);
    await ensureSkill(prisma, SKILL_METADATA);

    console.log("[migrate-lore-forge] done (skills only — agent owned by migrate-relic-forge)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-lore-forge] failed:", e);
  process.exit(1);
});
