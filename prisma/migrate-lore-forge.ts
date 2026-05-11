// Provisions LORE-FORGE-001 — bilingual lore + metadata generator.
//
// Final shape (post-picker-extraction, 2026-05-11):
//   mode-branch → loreEn (LLM_PROMPT, Gemini grounding+vision)
//                → loreZh (LLM_PROMPT, Gemini text)
//                → metadata-init (LLM_PROMPT, Gemini json+vision)
//   mode-branch → metadata-regen (LLM_PROMPT, same skill as init)
//
// Image-pick is a SEPARATE scene (relic.smart-image-pick → PICKER-FORGE-001)
// the pipeline step calls AFTER LORE-FORGE; the legacy slot-4 INTERNAL
// pick has been removed.
//
// All "context-prep" work (Prisma draftNote read + workspace FS scan +
// listing format) is done at the pipeline layer
// (lib/relics/pipeline/scanWorkspace.ts) BEFORE callScene, and arrives
// via SceneBinding ctx → agent.input.{userBrief,fileSummary,
// imageAbsPaths,textExcerpts}.
//
// Idempotent — heals stale shape from earlier-version environments
// (3-slot pre-picker-split + 4-slot pick-bundled).

import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_LORE_EN_PROMPT,
  DEFAULT_LORE_ZH_PROMPT,
  DEFAULT_METADATA_PROMPT,
} from "../lib/skills/relic-prompts";

const NEW_AGENT_CODENAME = "LORE-FORGE-001";

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
};

// — — DAG — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
//
// Final shape (3-slot + tail wrap-transform, agent.input pre-populated
// by scanWorkspace):
//
//   Slot layout:
//     1: gemini-lore-en (LLM_PROMPT)
//     2: gemini-lore-zh (LLM_PROMPT)
//     3: gemini-metadata (LLM_PROMPT — both metadata-init and
//        metadata-regen reference the SAME slotIndex)
//
//   Tail nodes (NO slotIndex — pure transform shaping the leaf output
//   to match the bound scene's outputSchema):
//     wrap-research (transform) — init path leaf, produces
//       { research: {...} } per relic.draft-metadata schema. Pulls
//       loreEn / loreZh / metadata-init outputs and merges into one
//       wrapped object.
//
//   Regen path: metadata-regen IS the leaf — its flat output already
//   matches relic.regen-metadata's flat schema (passthrough allows
//   extras like decisionReason). No tail transform needed.

const WRAP_RESEARCH_EXPRESSION = `{
  "research": {
    "titleZh": meta.titleZh,
    "titleEn": meta.titleEn,
    "subtitleZh": meta.subtitleZh,
    "subtitleEn": meta.subtitleEn,
    "icon": meta.icon,
    "rarity": meta.rarity,
    "formKind": meta.formKind,
    "decisionReason": meta.decisionReason,
    "useUserImage": meta.useUserImage,
    "networkImageQuery": meta.networkImageQuery,
    "loreEn": loreEn,
    "loreZh": loreZh
  }
}`;

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
      id: "loreEn",
      type: "skill" as const,
      slotIndex: 1,
      inputFrom: {
        merge: {
          userBrief: "agent.input.userBrief",
          fileSummary: "agent.input.fileSummary",
          imageAbsPaths: "agent.input.imageAbsPaths",
          textExcerpts: "agent.input.textExcerpts",
        },
      },
      position: { x: 280, y: 100 },
    },
    {
      id: "loreZh",
      type: "skill" as const,
      slotIndex: 2,
      inputFrom: { merge: { loreEn: "loreEn.output.text" } },
      position: { x: 480, y: 100 },
    },
    {
      id: "metadata-init",
      type: "skill" as const,
      slotIndex: 3,
      inputFrom: {
        merge: {
          loreEn: "loreEn.output.text",
          loreZh: "loreZh.output.text",
          imageAbsPaths: "agent.input.imageAbsPaths",
        },
      },
      position: { x: 680, y: 100 },
    },
    {
      id: "wrap-research",
      type: "transform" as const,
      inputFrom: {
        merge: {
          meta: "metadata-init.output",
          loreEn: "loreEn.output.text",
          loreZh: "loreZh.output.text",
        },
      },
      expression: WRAP_RESEARCH_EXPRESSION,
      position: { x: 880, y: 100 },
    },
    {
      id: "metadata-regen",
      type: "skill" as const,
      slotIndex: 3,
      inputFrom: {
        merge: {
          loreEn: "agent.input.existingLore.en",
          loreZh: "agent.input.existingLore.zh",
          feedback: "agent.input.feedback",
        },
      },
      position: { x: 280, y: 320 },
    },
  ],
  edges: [
    { from: "mode", to: "loreEn", when: "init" },
    { from: "loreEn", to: "loreZh" },
    { from: "loreZh", to: "metadata-init" },
    { from: "metadata-init", to: "wrap-research" },
    { from: "mode", to: "metadata-regen", when: "regen" },
  ],
};

// SceneBinding inputMap for relic.draft-metadata.
// scanWorkspace pre-fills userBrief / fileSummary / imageAbsPaths /
// textExcerpts on ctx; we forward them straight into agent.input.
const DRAFT_INPUT_MAP = {
  mode: "initial",
  relicSlug: "{{ctx.workspaceSlug}}",
  userBrief: "{{ctx.userBrief}}",
  fileSummary: "{{ctx.fileSummary}}",
  imageAbsPaths: "{{ctx.imageAbsPaths}}",
  textExcerpts: "{{ctx.textExcerpts}}",
};

// SceneBinding inputMap for relic.regen-metadata.
const REGEN_INPUT_MAP = {
  mode: "regenMetadata",
  relicSlug: "{{ctx.relicSlug}}",
  existingLore: "{{ctx.existingLore}}",
  feedback: "{{ctx.feedback}}",
};

// 2026-05-11: outputMap dropped — agent's tail wrap-research transform
// + metadata-regen leaf produce scene-shape directly. SceneBinding only
// holds inputMap now.

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
      kind: spec.kind,
      handlerConfig: spec.handlerConfig,
      status: "ONLINE",
    },
    select: { id: true },
  });
  console.log(`[migrate-lore-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
}

async function ensureForgeAgent(
  prisma: PrismaClient,
  skillIds: { loreEn: string; loreZh: string; metadata: string },
): Promise<string> {
  const existing = await prisma.agent.findUnique({ where: { codename: NEW_AGENT_CODENAME } });
  if (existing) {
    // Heal stale shape: drop slot-0 (legacy summary node) and slot-4
    // (legacy INTERNAL pick node, picker logic moved to PICKER-FORGE-001).
    // Force final shape.
    await prisma.agent.update({
      where: { id: existing.id },
      data: { pipelineConfig: FORGE_PIPELINE as unknown as Prisma.InputJsonValue },
    });
    const stale = await prisma.agentSkillEquip.deleteMany({
      where: { agentId: existing.id, slotIndex: { in: [0, 4] } },
    });
    if (stale.count > 0) {
      console.log(`[migrate-lore-forge] healed ${NEW_AGENT_CODENAME}: removed ${stale.count} stale equip(s) (slot 0/4)`);
    }
    for (const [slotIndex, skillId] of [
      [1, skillIds.loreEn],
      [2, skillIds.loreZh],
      [3, skillIds.metadata],
    ] as const) {
      const eq = await prisma.agentSkillEquip.findFirst({
        where: { agentId: existing.id, slotIndex },
      });
      if (!eq) {
        await prisma.agentSkillEquip.create({
          data: { agentId: existing.id, skillId, slotIndex, unlocked: true },
        });
        console.log(`[migrate-lore-forge] re-equipped ${NEW_AGENT_CODENAME} slot ${slotIndex}`);
      }
    }
    // Drop image-pick capability — it now lives on PICKER-FORGE-001.
    if (existing.capabilities.includes("image-pick")) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          capabilities: existing.capabilities.filter((c) => c !== "image-pick"),
        },
      });
      console.log(`[migrate-lore-forge] dropped image-pick capability from ${NEW_AGENT_CODENAME}`);
    }
    console.log(`[migrate-lore-forge] agent ${NEW_AGENT_CODENAME} already exists (${existing.id}); ensured final shape`);
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
          "Bilingual lore + metadata generator. Branch DAG: initial mode runs loreEn(grounded) → loreZh → metadata; regenMetadata mode jumps straight to metadata with existingLore. Workspace context pre-scanned at pipeline layer; image-pick handled by PICKER-FORGE-001 via a separate scene.",
        descriptionZh:
          "双语圣记 + 元数据生成器。分支 DAG：initial 模式跑 loreEn(grounded) → loreZh → metadata；regenMetadata 模式直接跳到 metadata,使用 existingLore。工作目录上下文由 pipeline 层预扫描;选图由 PICKER-FORGE-001 通过独立 scene 完成。",
        capabilities: ["lore-writing", "metadata-derivation"],
        pipelineConfig: FORGE_PIPELINE as unknown as Prisma.InputJsonValue,
        deployedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.agentSkillEquip.createMany({
      data: [
        { agentId: agent.id, skillId: skillIds.loreEn, slotIndex: 1, unlocked: true },
        { agentId: agent.id, skillId: skillIds.loreZh, slotIndex: 2, unlocked: true },
        { agentId: agent.id, skillId: skillIds.metadata, slotIndex: 3, unlocked: true },
      ],
    });
    return agent;
  });
  console.log(`[migrate-lore-forge] created agent ${NEW_AGENT_CODENAME} (${result.id}) + 3 equips`);
  return result.id;
}

async function rebindScene(
  prisma: PrismaClient,
  sceneKey: string,
  forgeId: string,
  inputMap: Record<string, unknown>,
  notes: string,
): Promise<void> {
  const binding = await prisma.sceneBinding.findUnique({ where: { sceneKey } });
  if (!binding) {
    console.log(`[migrate-lore-forge] no SceneBinding for ${sceneKey} — skip`);
    return;
  }
  // Always write — heals stale legacy inputMap shapes.
  await prisma.sceneBinding.update({
    where: { sceneKey },
    data: {
      agentId: forgeId,
      inputMap: inputMap as unknown as Prisma.InputJsonValue,
      notes,
    },
  });
  console.log(`[migrate-lore-forge] rebound ${sceneKey} → LORE-FORGE-001 (final shape)`);
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

    const loreEnId = await ensureSkill(prisma, SKILL_LORE_EN);
    const loreZhId = await ensureSkill(prisma, SKILL_LORE_ZH);
    const metadataId = await ensureSkill(prisma, SKILL_METADATA);

    const forgeId = await ensureForgeAgent(prisma, {
      loreEn: loreEnId,
      loreZh: loreZhId,
      metadata: metadataId,
    });

    await rebindScene(
      prisma,
      "relic.generate-draft-metadata",
      forgeId,
      DRAFT_INPUT_MAP,
      "LORE-FORGE-001 final shape: scanWorkspace pre-fills ctx; agent runs loreEn → loreZh → metadata-init → wrap-research, producing scene-shape directly. Pick handled by separate relic.smart-image-pick scene → PICKER-FORGE-001.",
    );
    await rebindScene(
      prisma,
      "relic.regen-metadata",
      forgeId,
      REGEN_INPUT_MAP,
      "LORE-FORGE-001 final shape: regen mode jumps straight to metadata-regen (flat shape matches regen scene schema directly).",
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
