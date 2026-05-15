// Post-push migration: collapse 3 single-purpose forge agents
// (LORE-FORGE-001 / CUTOUT-FORGE-001 / MESHY-FORGE-001) into one unified
// RELIC-FORGE-001 that owns the entire relic lifecycle (lore + metadata
// + 2D cutout + 3D generation).
//
// Why: the three forges each had cohesive single-domain responsibility,
// but the user wants a single omni agent that owns all 6 relic skills as
// a foundation for upcoming AUTONOMOUS exploration (one LLM agent with
// the full skill set). MECHANICAL stays in place — same 4 scene contracts
// route through one DAG with a 4-way mode branch instead of three
// independent agents.
//
// What this script does (idempotent):
//   1. Drops the deprecated `save-asset-enhanced` skill (replaced 2026-05-12
//      by the reusable `save-asset-relic` — itself retired 2026-05-13 in
//      favor of the backbone `persist` primitive).
//   2. Deletes LORE-FORGE-001 / CUTOUT-FORGE-001 / MESHY-FORGE-001 if
//      present. Cascade on Agent FK auto-cleans AgentSkillEquip and
//      AgentJob history — user explicitly approved losing forge job
//      history in plan.
//   3. Upserts RELIC-FORGE-001 with the unified 4-branch pipelineConfig
//      and 5 equips referencing the 5 surviving skills (created by prior
//      migrate-{lore,cutout,meshy}-forge.ts skill-ensure passes). Slot 5
//      stays empty — the save-asset-relic skill that used to live there
//      was retired 2026-05-13; persistence now happens via the `persist`
//      backbone primitive (runtime infrastructure, not a skill).
//   4. Rebinds 4 relic.* scenes to RELIC-FORGE-001.
//
// Required env: DATABASE_URL.

import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const NEW_AGENT_CODENAME = "RELIC-FORGE-001";

const OLD_FORGE_CODENAMES = [
  "LORE-FORGE-001",
  "CUTOUT-FORGE-001",
  "MESHY-FORGE-001",
];

// save-asset-enhanced retired 2026-05-12; save-asset-relic retired
// 2026-05-13 (replaced by `persist` backbone primitive). Both removed by
// the migrate-replace-save-asset.ts step, but listed here so this script
// idempotently cleans up any leftover rows in older databases.
const DEPRECATED_SKILL_SLUGS = ["save-asset-enhanced", "save-asset-relic"];

// 5 skill slugs equipped by RELIC-FORGE-001 (slot indices 0..4). Slot 5
// stays empty after the 2026-05-13 retirement of save-asset-relic — the
// persist backbone primitive (runtime infrastructure) replaces it.
// All 5 skills are created by migrate-{lore,cutout,meshy}-forge.ts ahead
// of this script — we only LOOK UP, never recreate.
const SKILL_SLUGS = {
  loreEn: "gemini-lore-en",
  loreZh: "gemini-lore-zh",
  metadata: "gemini-metadata",
  cutout: "fal-cutout-http",
  meshy: "meshy-3d-http",
} as const;

// 4 relic.* scene contracts this forge now serves.
const SCENE_KEYS = [
  "relic.generate-draft-metadata",
  "relic.regen-metadata",
  "relic.enhance2d",
  "relic.create3d",
];

// Union of all 3 retired forges' capability tags (image-cutout was
// duplicated on both CUTOUT + MESHY — deduped here).
const CAPABILITIES = [
  "lore-writing",
  "metadata-derivation",
  "image-cutout",
  "model-3d-generation",
];

// — — JSONata expressions for tail transform nodes — — — — — — — — — — —

// init-mode leaf: same shape as LORE-FORGE wrap-research — produces
// scene-contract { research: {...} } for relic.generate-draft-metadata.
const WRAP_RESEARCH_EXPRESSION = `{
  "research": {
    "titleZh": meta.titleZh,
    "titleEn": meta.titleEn,
    "subtitleZh": meta.subtitleZh,
    "subtitleEn": meta.subtitleEn,
    "icon": meta.icon,
    "rarity": meta.rarity,
    "decisionReason": meta.decisionReason,
    "useUserImage": meta.useUserImage,
    "networkImageQuery": meta.networkImageQuery,
    "loreEn": loreEn,
    "loreZh": loreZh
  }
}`;

// 2dEnhance leaf: produces { enhancedImagePath, _relicWriteback } per
// relic.enhance2d scene contract + runner writeback hook.
const SHAPE_CUTOUT_EXPRESSION = `{
  "enhancedImagePath": save.savedPath,
  "_relicWriteback": {
    "id": relicId,
    "fields": {
      "enhancedImagePath": save.savedPath
    }
  }
}`;

// 3dCreate leaf: produces { modelPath, taskId, previewImageUrl,
// _relicWriteback } per relic.create3d scene contract.
const SHAPE_MESHY_EXPRESSION = `{
  "modelPath": save.savedPath,
  "taskId": meshy.taskId,
  "previewImageUrl": meshy.previewImageUrl,
  "_relicWriteback": {
    "id": relicId,
    "fields": {
      "modelPath": save.savedPath
    }
  }
}`;

// — — Unified DAG: 4-way mode branch + 4 chains — — — — — — — — — — — —
//
// Routing on input.mode (injected by scene.prepareAgentInput):
//   "initial"        → loreEn → loreZh → metadata-init → wrap-research
//   "regenMetadata"  → metadata-regen
//   "2dEnhance"      → cutout → save-cutout (persist) → shape-cutout
//   "3dCreate"       → meshy  → save-meshy  (persist) → shape-meshy
//
// No defaultLabel on the mode branch — a missing mode value is a scene
// wiring bug and should surface as BRANCH_NO_MATCH at runtime, not
// silently fall through to one of the chains.
//
// metadata-init and metadata-regen both reference slotIndex 2 (same
// gemini-metadata Skill); save-cutout and save-meshy are now `persist`
// backbone primitive nodes (NOT skills) — runtime data-persistence
// infrastructure rather than equipped capabilities. Slot 5 stays empty.
function buildForgePipeline(): Prisma.InputJsonValue {
  return {
    version: 2 as const,
    nodes: [
      // Root branch.
      {
        id: "mode",
        type: "branch" as const,
        inputFrom: "agent.input",
        cases: [
          { path: "mode", op: "eq" as const, value: "initial", label: "init" },
          { path: "mode", op: "eq" as const, value: "regenMetadata", label: "regen" },
          { path: "mode", op: "eq" as const, value: "2dEnhance", label: "enhance" },
          { path: "mode", op: "eq" as const, value: "3dCreate", label: "create" },
        ],
        position: { x: 60, y: 400 },
      },
      // — initial chain (y=100) —
      {
        id: "loreEn",
        type: "skill" as const,
        slotIndex: 0,
        inputFrom: {
          merge: {
            userBrief: "agent.input.userBrief",
            fileSummary: "agent.input.fileSummary",
            imageAbsPaths: "agent.input.imageAbsPaths",
            textExcerpts: "agent.input.textExcerpts",
          },
        },
        position: { x: 320, y: 60 },
      },
      {
        id: "loreZh",
        type: "skill" as const,
        slotIndex: 1,
        inputFrom: { merge: { loreEn: "loreEn.output.text" } },
        position: { x: 540, y: 60 },
      },
      {
        id: "metadata-init",
        type: "skill" as const,
        slotIndex: 2,
        inputFrom: {
          merge: {
            loreEn: "loreEn.output.text",
            loreZh: "loreZh.output.text",
            imageAbsPaths: "agent.input.imageAbsPaths",
          },
        },
        position: { x: 760, y: 60 },
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
        position: { x: 980, y: 60 },
      },
      // — regenMetadata chain (y=280) —
      {
        id: "metadata-regen",
        type: "skill" as const,
        slotIndex: 2,
        inputFrom: {
          merge: {
            loreEn: "agent.input.existingLore.en",
            loreZh: "agent.input.existingLore.zh",
            feedback: "agent.input.feedback",
          },
        },
        position: { x: 320, y: 280 },
      },
      // — 2dEnhance chain (y=480) —
      {
        id: "cutout",
        type: "skill" as const,
        slotIndex: 3,
        inputFrom: { merge: { dataUri: "agent.input.imageDataUri" } },
        position: { x: 320, y: 480 },
      },
      {
        id: "save-cutout",
        type: "persist" as const,
        inputFrom: {
          merge: {
            base64: "cutout.output.downloadBase64",
            contentType: "cutout.output.downloadContentType",
            relicSlug: "agent.input.relicSlug",
            kind: "agent.input.kind",
          },
        },
        position: { x: 540, y: 480 },
      },
      {
        id: "shape-cutout",
        type: "transform" as const,
        inputFrom: {
          merge: {
            save: "save-cutout.output",
            relicId: "agent.input._relicId",
          },
        },
        expression: SHAPE_CUTOUT_EXPRESSION,
        position: { x: 760, y: 480 },
      },
      // — 3dCreate chain (y=680) —
      {
        id: "meshy",
        type: "skill" as const,
        slotIndex: 4,
        inputFrom: {
          merge: {
            dataUri: "agent.input.imageDataUri",
            opts: "agent.input.opts",
          },
        },
        position: { x: 320, y: 680 },
      },
      {
        id: "save-meshy",
        type: "persist" as const,
        inputFrom: {
          merge: {
            base64: "meshy.output.downloadBase64",
            contentType: "meshy.output.downloadContentType",
            relicSlug: "agent.input.relicSlug",
            kind: "agent.input.kind",
          },
        },
        position: { x: 540, y: 680 },
      },
      {
        id: "shape-meshy",
        type: "transform" as const,
        inputFrom: {
          merge: {
            save: "save-meshy.output",
            meshy: "meshy.output",
            relicId: "agent.input._relicId",
          },
        },
        expression: SHAPE_MESHY_EXPRESSION,
        position: { x: 760, y: 680 },
      },
    ],
    edges: [
      // initial
      { from: "mode", to: "loreEn", when: "init" },
      { from: "loreEn", to: "loreZh" },
      { from: "loreZh", to: "metadata-init" },
      { from: "metadata-init", to: "wrap-research" },
      // regen
      { from: "mode", to: "metadata-regen", when: "regen" },
      // 2dEnhance
      { from: "mode", to: "cutout", when: "enhance" },
      { from: "cutout", to: "save-cutout" },
      { from: "save-cutout", to: "shape-cutout" },
      // 3dCreate
      { from: "mode", to: "meshy", when: "create" },
      { from: "meshy", to: "save-meshy" },
      { from: "save-meshy", to: "shape-meshy" },
    ],
  } as unknown as Prisma.InputJsonValue;
}

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(12).toString("hex").slice(0, 21 - ts.length);
  return `c${ts}${rand}`.padEnd(25, "0").slice(0, 25);
}

async function dropDeprecatedSkill(prisma: PrismaClient): Promise<void> {
  for (const slug of DEPRECATED_SKILL_SLUGS) {
    const result = await prisma.skill.deleteMany({ where: { slug } });
    if (result.count > 0) {
      console.log(`[migrate-relic-forge] dropped deprecated skill "${slug}"`);
    }
  }
}

async function dropOldForgeAgents(prisma: PrismaClient): Promise<void> {
  const result = await prisma.agent.deleteMany({
    where: { codename: { in: OLD_FORGE_CODENAMES } },
  });
  if (result.count > 0) {
    console.log(
      `[migrate-relic-forge] removed ${result.count} retired forge agent(s) (cascade deleted equips + AgentJob history)`,
    );
  }
}

async function lookupRequiredSkills(prisma: PrismaClient): Promise<Record<keyof typeof SKILL_SLUGS, string>> {
  const slugs = Object.values(SKILL_SLUGS);
  const rows = await prisma.skill.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
  const out: Partial<Record<keyof typeof SKILL_SLUGS, string>> = {};
  for (const [key, slug] of Object.entries(SKILL_SLUGS) as Array<[keyof typeof SKILL_SLUGS, string]>) {
    const id = bySlug.get(slug);
    if (!id) {
      throw new Error(
        `[migrate-relic-forge] required skill "${slug}" missing — run migrate-{lore,cutout,meshy}-forge first to seed it`,
      );
    }
    out[key] = id;
  }
  return out as Record<keyof typeof SKILL_SLUGS, string>;
}

async function ensureRelicForgeAgent(
  prisma: PrismaClient,
  skillIds: Record<keyof typeof SKILL_SLUGS, string>,
): Promise<string> {
  const pipelineConfig = buildForgePipeline();
  const existing = await prisma.agent.findUnique({
    where: { codename: NEW_AGENT_CODENAME },
  });

  if (existing) {
    // Heal: refresh DAG + capabilities, then reset equips to the canonical
    // 6-slot loadout. deleteMany covers any drift; createMany re-establishes
    // the slot map.
    await prisma.agent.update({
      where: { id: existing.id },
      data: {
        pipelineConfig,
        capabilities: CAPABILITIES,
        nameEn: "Relic Forge",
        nameZh: "圣物熔炉",
        codenameZh: "圣物熔炉",
      },
    });
    await prisma.agentSkillEquip.deleteMany({ where: { agentId: existing.id } });
    await prisma.agentSkillEquip.createMany({
      data: [
        { agentId: existing.id, skillId: skillIds.loreEn, slotIndex: 0, unlocked: true },
        { agentId: existing.id, skillId: skillIds.loreZh, slotIndex: 1, unlocked: true },
        { agentId: existing.id, skillId: skillIds.metadata, slotIndex: 2, unlocked: true },
        { agentId: existing.id, skillId: skillIds.cutout, slotIndex: 3, unlocked: true },
        { agentId: existing.id, skillId: skillIds.meshy, slotIndex: 4, unlocked: true },
      ],
    });
    console.log(`[migrate-relic-forge] healed ${NEW_AGENT_CODENAME} (${existing.id}): refreshed DAG + 5 equips (slot 5 empty — persist primitive)`);
    return existing.id;
  }

  const id = genCuid();
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        id,
        codename: NEW_AGENT_CODENAME,
        codenameZh: "圣物熔炉",
        nameEn: "Relic Forge",
        nameZh: "圣物熔炉",
        mode: "MECHANICAL",
        status: "DEPLOYED",
        avatarUrl: "/images/agent-control/avatars/placeholder.svg",
        capabilities: CAPABILITIES,
        pipelineConfig,
        deployedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.agentSkillEquip.createMany({
      data: [
        { agentId: agent.id, skillId: skillIds.loreEn, slotIndex: 0, unlocked: true },
        { agentId: agent.id, skillId: skillIds.loreZh, slotIndex: 1, unlocked: true },
        { agentId: agent.id, skillId: skillIds.metadata, slotIndex: 2, unlocked: true },
        { agentId: agent.id, skillId: skillIds.cutout, slotIndex: 3, unlocked: true },
        { agentId: agent.id, skillId: skillIds.meshy, slotIndex: 4, unlocked: true },
      ],
    });
    return agent;
  });
  console.log(`[migrate-relic-forge] created ${NEW_AGENT_CODENAME} (${result.id}) + 5 equips (slot 5 empty — persist primitive)`);
  return result.id;
}

async function rebindScenes(prisma: PrismaClient, agentId: string): Promise<void> {
  for (const sceneKey of SCENE_KEYS) {
    const existing = await prisma.sceneBinding.findUnique({ where: { sceneKey } });
    if (existing) {
      await prisma.sceneBinding.update({
        where: { sceneKey },
        data: {
          agentId,
          enabled: true,
          notes: "RELIC-FORGE-001 unified omni-forge — 4-way mode branch over 6 skills.",
        },
      });
    } else {
      await prisma.sceneBinding.create({
        data: {
          sceneKey,
          agentId,
          enabled: true,
          notes: "RELIC-FORGE-001 unified omni-forge — 4-way mode branch over 6 skills.",
        },
      });
    }
    console.log(`[migrate-relic-forge] bound ${sceneKey} → ${NEW_AGENT_CODENAME}`);
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-relic-forge] SceneBinding table absent — skip (run earlier migrations first)");
      return;
    }

    // Order matters: SceneBinding.agentId is onDelete: Restrict (NOT
    // Cascade like AgentJob / AgentSkillEquip), so we MUST move the
    // bindings off the old forges BEFORE deleting them.
    //
    //   1. drop the deprecated save-asset-enhanced skill (cascade clears
    //      its AgentSkillEquip rows on CUTOUT-FORGE-001 slot 2)
    //   2. look up the 6 surviving skill IDs by slug (created by the
    //      preceding migrate-{lore,cutout,meshy}-forge passes)
    //   3. create / heal RELIC-FORGE-001 with all 6 equips
    //   4. rebind 4 relic.* SceneBindings to RELIC-FORGE-001
    //   5. only NOW delete the 3 old forge agents (no SceneBinding
    //      references → FK Restrict allows it; AgentJob + Equip cascade)
    await dropDeprecatedSkill(prisma);
    const skillIds = await lookupRequiredSkills(prisma);
    const forgeId = await ensureRelicForgeAgent(prisma, skillIds);
    await rebindScenes(prisma, forgeId);
    await dropOldForgeAgents(prisma);

    console.log("[migrate-relic-forge] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-relic-forge] failed:", e);
  process.exit(1);
});
