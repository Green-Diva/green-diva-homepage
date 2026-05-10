// Phase 5 R2 — provisions LORE-FORGE-001, the third forge agent. Replaces
// the SCRIBE-bound metadata path (slot 1 = relic-gemini-researcher) with
// a config-driven 5-skill chain:
//
//   summary (INTERNAL, reused) → loreEn (LLM_PROMPT, gemini grounding+vision)
//                              → loreZh (LLM_PROMPT, gemini text)
//                              → metadata-init (LLM_PROMPT, gemini json+vision)
//                              → pick (INTERNAL, smart-image-picker reused)
//
// Plus a regen-only branch:
//   mode-router → metadata-regen (LLM_PROMPT, same skill as metadata-init)
//
// Once this migration runs, the SceneBindings for relic.draft-metadata
// and relic.regen-metadata route to LORE-FORGE-001 instead of SCRIBE,
// and the legacy relic-gemini-researcher INTERNAL handler can be safely
// deleted in a follow-up commit (no live agent will reference it).
//
// Idempotent.

import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_LORE_EN_PROMPT,
  DEFAULT_LORE_ZH_PROMPT,
  DEFAULT_METADATA_PROMPT,
} from "../lib/skills/relic-prompts";

const NEW_AGENT_CODENAME = "LORE-FORGE-001";

// — — Skill specs — — — — — — — — — — — — — — — — — — — — — — — — — —

// Pass 1: English lore with grounded research. The DEFAULT_LORE_EN_PROMPT
// constant (still in source for now) is the canonical baseline copied
// from the legacy geminiResearcher. Admin can edit it via SkillLibrary
// once the agent is live.
const SKILL_LORE_EN = {
  slug: "gemini-lore-en",
  nameEn: "Gemini Lore (EN, grounded)",
  nameZh: "Gemini 圣记（英文 · grounding）",
  icon: "auto_stories",
  descriptionEn:
    "Pass 1 of the lore chain. Gemini 2.5 with Google Search grounding + vision; produces ≤110-word English markdown lore from user images + file summary. Prompt admin-editable in handlerConfig.",
  descriptionZh:
    "圣记链第一步。Gemini 2.5 启用 Google Search grounding + 视觉，根据用户图与文件摘要写 ≤110 词英文 markdown 圣记。Prompt 在 handlerConfig 可改。",
  handlerKind: "LLM_PROMPT" as const,
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
};

const SKILL_LORE_ZH = {
  slug: "gemini-lore-zh",
  nameEn: "Gemini Lore (ZH, translation)",
  nameZh: "Gemini 圣记（中译）",
  icon: "translate",
  descriptionEn:
    "Pass 2 of the lore chain. Gemini 2.5 (no grounding, no vision) — translates the English lore into a literary ≤140-字 Chinese version, applying the editorial style rules in the prompt.",
  descriptionZh:
    "圣记链第二步。Gemini 2.5（无 grounding、无视觉）—— 把英文圣记意译为 ≤140 字的中文版本,按 prompt 的文风规约削减虚词。",
  handlerKind: "LLM_PROMPT" as const,
  handlerConfig: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    authEnv: "GEMINI_API_KEY",
    grounding: false,
    maxTokens: 4096,
    systemPrompt: DEFAULT_LORE_ZH_PROMPT,
    userTemplate: "{{loreEn}}",
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
  handlerKind: "LLM_PROMPT" as const,
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
};

// — — DAG — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
//
// Branch on input.mode. "initial" walks the full lore chain; "regenMetadata"
// jumps straight to the metadata node with existingLore wired in.
//
// Slot layout:
//   0: relic-files-summary (INTERNAL — reused)
//   1: gemini-lore-en (LLM_PROMPT)
//   2: gemini-lore-zh (LLM_PROMPT)
//   3: gemini-metadata (LLM_PROMPT — both metadata-init and metadata-regen
//      reference the SAME equipSlot; backbone runtime instantiates the
//      skill with the per-node inputFrom merge each time)
//   4: relic-smart-image-pick (INTERNAL — reused)
const FORGE_PIPELINE = {
  version: 2 as const,
  nodes: [
    {
      id: "mode",
      type: "branch" as const,
      inputFrom: "agent.input",
      cases: [
        { path: "mode", op: "eq" as const, value: "initial", label: "init" },
        { path: "mode", op: "eq" as const, value: "regenMetadata", label: "regen" },
      ],
      position: { x: 60, y: 200 },
    },
    {
      id: "summary",
      type: "skill" as const,
      equipSlot: 0,
      inputFrom: "agent.input",
      position: { x: 280, y: 100 },
    },
    {
      id: "loreEn",
      type: "skill" as const,
      equipSlot: 1,
      inputFrom: {
        merge: {
          userBrief: "agent.input.userBrief",
          fileSummary: "summary.output.fileSummary",
          imageAbsPaths: "summary.output.imageAbsPaths",
          textExcerpts: "summary.output.textExcerpts",
        },
      },
      position: { x: 480, y: 100 },
    },
    {
      id: "loreZh",
      type: "skill" as const,
      equipSlot: 2,
      inputFrom: { merge: { loreEn: "loreEn.output.text" } },
      position: { x: 680, y: 100 },
    },
    {
      id: "metadata-init",
      type: "skill" as const,
      equipSlot: 3,
      inputFrom: {
        merge: {
          loreEn: "loreEn.output.text",
          loreZh: "loreZh.output.text",
          imageAbsPaths: "summary.output.imageAbsPaths",
        },
      },
      position: { x: 880, y: 100 },
    },
    {
      id: "pick",
      type: "skill" as const,
      equipSlot: 4,
      inputFrom: {
        merge: {
          relicSlug: "agent.input.relicSlug",
          imageAbsPaths: "summary.output.imageAbsPaths",
          useUserImage: "metadata-init.output.useUserImage",
          networkImageQuery: "metadata-init.output.networkImageQuery",
        },
      },
      position: { x: 1080, y: 100 },
    },
    {
      id: "metadata-regen",
      type: "skill" as const,
      equipSlot: 3,
      inputFrom: {
        merge: {
          loreEn: "agent.input.existingLore.en",
          loreZh: "agent.input.existingLore.zh",
          feedback: "agent.input.feedback",
        },
      },
      position: { x: 480, y: 320 },
    },
  ],
  edges: [
    { from: "mode", to: "summary", when: "init" },
    { from: "summary", to: "loreEn" },
    { from: "loreEn", to: "loreZh" },
    { from: "loreZh", to: "metadata-init" },
    { from: "metadata-init", to: "pick" },
    { from: "mode", to: "metadata-regen", when: "regen" },
  ],
};

// — — outputMap updates — — — — — — — — — — — — — — — — — — — — — — — —

// Pipeline step (lib/relics/pipeline/steps/generateMetadata.ts) reads
// result.output.research.* and result.output.pick.*. Build that shape
// from the new node IDs.
const DRAFT_METADATA_OUTPUT_MAP = {
  research: {
    titleZh: "{{runLog.byId.metadata-init.output.titleZh}}",
    titleEn: "{{runLog.byId.metadata-init.output.titleEn}}",
    subtitleZh: "{{runLog.byId.metadata-init.output.subtitleZh}}",
    subtitleEn: "{{runLog.byId.metadata-init.output.subtitleEn}}",
    icon: "{{runLog.byId.metadata-init.output.icon}}",
    rarity: "{{runLog.byId.metadata-init.output.rarity}}",
    formKind: "{{runLog.byId.metadata-init.output.formKind}}",
    decisionReason: "{{runLog.byId.metadata-init.output.decisionReason}}",
    loreEn: "{{runLog.byId.loreEn.output.text}}",
    loreZh: "{{runLog.byId.loreZh.output.text}}",
  },
  pick: "{{runLog.byId.pick.output}}",
};

// regen-metadata endpoint reads result.output.{titleZh, titleEn, ...}.
// metadata-regen node returns the LLM_PROMPT JSON parse result directly,
// so we expose its fields at the root.
const REGEN_METADATA_OUTPUT_MAP = {
  titleZh: "{{runLog.byId.metadata-regen.output.titleZh}}",
  titleEn: "{{runLog.byId.metadata-regen.output.titleEn}}",
  subtitleZh: "{{runLog.byId.metadata-regen.output.subtitleZh}}",
  subtitleEn: "{{runLog.byId.metadata-regen.output.subtitleEn}}",
  icon: "{{runLog.byId.metadata-regen.output.icon}}",
  rarity: "{{runLog.byId.metadata-regen.output.rarity}}",
  formKind: "{{runLog.byId.metadata-regen.output.formKind}}",
};

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(12).toString("hex").slice(0, 21 - ts.length);
  return `c${ts}${rand}`.padEnd(25, "0").slice(0, 25);
}

async function ensureSkill(
  prisma: PrismaClient,
  spec: typeof SKILL_LORE_EN | typeof SKILL_LORE_ZH | typeof SKILL_METADATA,
): Promise<string> {
  const existing = await prisma.skill.findUnique({ where: { slug: spec.slug } });
  if (existing) {
    console.log(`[migrate-lore-forge] skill "${spec.slug}" already exists (${existing.id}); skipping`);
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
      handlerKind: spec.handlerKind,
      handlerConfig: spec.handlerConfig,
      status: "ONLINE",
    },
    select: { id: true },
  });
  console.log(`[migrate-lore-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
}

// Look up an INTERNAL skill row by its handlerConfig.handler slug. Used
// to find the existing relic-files-summary and relic-smart-image-pick
// rows that LORE-FORGE will share with SCRIBE.
async function lookupInternalSkillByHandler(
  prisma: PrismaClient,
  handlerSlug: string,
): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "Skill"
     WHERE "handlerKind" = 'INTERNAL'
       AND "handlerConfig"->>'handler' = $1
     LIMIT 1`,
    handlerSlug,
  );
  if (rows.length === 0) {
    throw new Error(
      `[migrate-lore-forge] expected INTERNAL skill with handler="${handlerSlug}" to exist (run earlier migrations first)`,
    );
  }
  return rows[0].id;
}

async function ensureForgeAgent(
  prisma: PrismaClient,
  skillIds: { summary: string; loreEn: string; loreZh: string; metadata: string; pick: string },
): Promise<string> {
  const existing = await prisma.agent.findUnique({ where: { codename: NEW_AGENT_CODENAME } });
  if (existing) {
    console.log(`[migrate-lore-forge] agent ${NEW_AGENT_CODENAME} already exists (${existing.id}); skipping creation`);
    return existing.id;
  }

  const id = genCuid();
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        id,
        codename: NEW_AGENT_CODENAME,
        codenameZh: "圣记熔炉",
        nameEn: "Lore Forge",
        nameZh: "圣记熔炉",
        mode: "MECHANICAL",
        status: "ONLINE",
        avatarUrl: "/images/agent-control/avatars/placeholder.svg",
        descriptionEn:
          "Bilingual lore + metadata generator. Branch DAG: initial mode runs summary → loreEn(grounded) → loreZh → metadata → pick; regenMetadata mode jumps to metadata with existingLore.",
        descriptionZh:
          "双语圣记 + 元数据生成器。分支 DAG：initial 模式跑 summary → loreEn(grounded) → loreZh → metadata → pick；regenMetadata 模式直接跳到 metadata,使用 existingLore。",
        capabilities: ["lore-writing", "metadata-derivation", "image-pick"],
        pipelineConfig: FORGE_PIPELINE as unknown as Prisma.InputJsonValue,
        deployedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.agentSkillEquip.createMany({
      data: [
        { agentId: agent.id, skillId: skillIds.summary, slotIndex: 0, unlocked: true },
        { agentId: agent.id, skillId: skillIds.loreEn, slotIndex: 1, unlocked: true },
        { agentId: agent.id, skillId: skillIds.loreZh, slotIndex: 2, unlocked: true },
        { agentId: agent.id, skillId: skillIds.metadata, slotIndex: 3, unlocked: true },
        { agentId: agent.id, skillId: skillIds.pick, slotIndex: 4, unlocked: true },
      ],
    });
    return agent;
  });
  console.log(`[migrate-lore-forge] created agent ${NEW_AGENT_CODENAME} (${result.id}) + 5 equips`);
  return result.id;
}

async function rebindScene(
  prisma: PrismaClient,
  sceneKey: string,
  forgeId: string,
  outputMap: Record<string, unknown>,
  notes: string,
): Promise<void> {
  const binding = await prisma.sceneBinding.findUnique({ where: { sceneKey } });
  if (!binding) {
    console.log(`[migrate-lore-forge] no SceneBinding for ${sceneKey} — skip`);
    return;
  }
  if (binding.agentId === forgeId) {
    // Refresh outputMap in case the prior R1 outputMap is now stale (it
    // referenced "research"/"pick" or "research-regen" node IDs that no
    // longer exist in LORE-FORGE).
    await prisma.sceneBinding.update({
      where: { sceneKey },
      data: { outputMap: outputMap as unknown as Prisma.InputJsonValue, notes },
    });
    console.log(`[migrate-lore-forge] ${sceneKey} already bound to LORE-FORGE; refreshed outputMap`);
    return;
  }
  await prisma.sceneBinding.update({
    where: { sceneKey },
    data: {
      agentId: forgeId,
      outputMap: outputMap as unknown as Prisma.InputJsonValue,
      notes,
    },
  });
  console.log(`[migrate-lore-forge] rebound ${sceneKey} → LORE-FORGE-001`);
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

    const summaryId = await lookupInternalSkillByHandler(prisma, "relic-files-summary");
    const pickId = await lookupInternalSkillByHandler(prisma, "relic-smart-image-pick");
    const loreEnId = await ensureSkill(prisma, SKILL_LORE_EN);
    const loreZhId = await ensureSkill(prisma, SKILL_LORE_ZH);
    const metadataId = await ensureSkill(prisma, SKILL_METADATA);

    const forgeId = await ensureForgeAgent(prisma, {
      summary: summaryId,
      loreEn: loreEnId,
      loreZh: loreZhId,
      metadata: metadataId,
      pick: pickId,
    });

    await rebindScene(
      prisma,
      "relic.draft-metadata",
      forgeId,
      DRAFT_METADATA_OUTPUT_MAP,
      "Phase 5 R2: routed to LORE-FORGE-001 (summary → loreEn → loreZh → metadata → pick). outputMap exposes runLog.byId.<node>.output under stable research/pick keys for the pipeline step.",
    );
    await rebindScene(
      prisma,
      "relic.regen-metadata",
      forgeId,
      REGEN_METADATA_OUTPUT_MAP,
      "Phase 5 R2: routed to LORE-FORGE-001 (mode-router → metadata-regen). outputMap surfaces metadata fields at result.output root for the regen endpoint.",
    );

    console.log("[migrate-lore-forge] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-lore-forge] failed:", e);
  process.exit(1);
});
