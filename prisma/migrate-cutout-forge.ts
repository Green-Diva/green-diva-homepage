// One-shot migration: provisions CUTOUT-FORGE-001 — a dedicated cutout
// agent implemented as a 2-skill chain (HTTP_API fal-cutout → HTTP_API
// save-asset). Image data URI is pre-encoded by the trigger endpoint
// (lib/relics/readImageAsDataUri.ts) and arrives via SceneBinding ctx →
// agent.input.imageDataUri.
//
// What it creates / does (idempotent):
//   1. Skill "fal-cutout-http"     (HTTP_API → fal.ai BiRefNet)
//   2. Skill "save-asset-enhanced" (HTTP_API → /api/internal/save-asset
//                                    with _relicWriteback into
//                                    enhancedImagePath)
//   3. Agent "CUTOUT-FORGE-001"    (MECHANICAL, 2-slot chain DAG)
//   4. AgentSkillEquip × 2          (slots 1, 2)
//   5. SceneBinding update for relic.enhance2d → CUTOUT-FORGE-001
//      (always written so re-runs heal stale legacy inputMap shapes)
//
// Required env: DATABASE_URL.

import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const NEW_AGENT_CODENAME = "CUTOUT-FORGE-001";

const SKILL_FAL_CUTOUT = {
  slug: "fal-cutout-http",
  nameEn: "fal.ai Cutout (HTTP)",
  nameZh: "fal.ai 抠图（HTTP）",
  icon: "auto_fix_high",
  descriptionEn:
    "Submits a data-URI image to fal.ai's BiRefNet endpoint, downloads the resulting transparent PNG. URL / model / timeout are admin-editable in handlerConfig.",
  descriptionZh:
    "把 data URI 图片提交给 fal.ai BiRefNet，下载生成的透明 PNG。URL / 模型 / 超时全在 handlerConfig 可改。",
  kind: "HTTP_API" as const,
  handlerConfig: {
    method: "POST",
    url: "https://fal.run/fal-ai/birefnet/v2",
    authEnv: "FAL_API_KEY",
    authScheme: "Key",
    timeoutMs: 60_000,
    bodyTemplate: {
      // Input shape (from agent.input via inputMap):
      //   { dataUri }
      image_url: "{{dataUri}}",
    },
    download: {
      urlPath: "image.url",
      field: "_download",
      maxBytes: 25 * 1024 * 1024,
    },
    responseTransform: {
      downloadBase64: "{{response._download.base64}}",
      downloadContentType: "{{response._download.contentType}}",
      sourceUrl: "{{response.image.url}}",
    },
  } as Prisma.InputJsonValue,
};

const SKILL_SAVE_ASSET_ENHANCED = {
  slug: "save-asset-enhanced",
  nameEn: "Save Enhanced Asset",
  nameZh: "保存增强资产",
  icon: "save",
  descriptionEn:
    "POSTs a base64 blob to /api/internal/save-asset with kind=enhanced, then emits _relicWriteback into Relic.enhancedImagePath so runner persists it. Sibling of save-asset-relic — only difference is the writeback field.",
  descriptionZh:
    "把 base64 blob POST 到 /api/internal/save-asset (kind=enhanced)，再产出 _relicWriteback 让 runner 写回 Relic.enhancedImagePath。跟 save-asset-relic 几乎一样,只是写回字段不同。",
  kind: "HTTP_API" as const,
  handlerConfig: {
    method: "POST",
    url: "http://localhost:3000/api/internal/save-asset",
    authEnv: "INTERNAL_SERVICE_TOKEN",
    authScheme: "Header",
    authHeader: "X-Internal-Token",
    timeoutMs: 30_000,
    bodyTemplate: {
      relicSlug: "{{relicSlug}}",
      kind: "enhanced",
      base64: "{{downloadBase64}}",
      contentType: "{{downloadContentType}}",
    },
    // Skill stays a pure IO operation — emits raw save result only.
    // The agent's tail `shape-output` transform composes the
    // `_relicWriteback` envelope (clean separation: skill = atomic IO,
    // agent = wrapping / contract shaping).
    responseTransform: {
      savedPath: "{{response.savedPath}}",
      bytes: "{{response.bytes}}",
    },
  } as Prisma.InputJsonValue,
};

// CUTOUT-FORGE-001 backbone DAG (v2 final): 2-skill chain + tail transform.
//   agent.input.imageDataUri → cutout → save → shape-output
//
// shape-output composes BOTH the scene-contract field
// (`enhancedImagePath`) AND the runner writeback envelope
// (`_relicWriteback`). The save skill stays a pure IO call; agent owns
// the wrapping. Pulls relicId from agent.input so the transform can
// build _relicWriteback.id without the skill knowing about it.
const SHAPE_OUTPUT_EXPRESSION = `{
  "enhancedImagePath": save.savedPath,
  "_relicWriteback": {
    "id": relicId,
    "fields": {
      "enhancedImagePath": save.savedPath
    }
  }
}`;

const FORGE_PIPELINE = {
  version: 2 as const,
  nodes: [
    {
      id: "cutout",
      type: "skill" as const,
      slotIndex: 1,
      inputFrom: { merge: { dataUri: "agent.input.imageDataUri" } },
      position: { x: 60, y: 200 },
    },
    {
      id: "save",
      type: "skill" as const,
      slotIndex: 2,
      inputFrom: {
        merge: {
          downloadBase64: "cutout.output.downloadBase64",
          downloadContentType: "cutout.output.downloadContentType",
          relicSlug: "agent.input.relicSlug",
        },
      },
      position: { x: 380, y: 200 },
    },
    {
      id: "shape-output",
      type: "transform" as const,
      inputFrom: {
        merge: {
          save: "save.output",
          relicId: "agent.input._relicId",
        },
      },
      expression: SHAPE_OUTPUT_EXPRESSION,
      position: { x: 700, y: 200 },
    },
  ],
  edges: [
    { from: "cutout", to: "save" },
    { from: "save", to: "shape-output" },
  ],
};

const FORGE_INPUT_MAP_ENHANCE2D = {
  relicSlug: "{{ctx.relicSlug}}",
  imageDataUri: "{{ctx.imageDataUri}}",
  _relicId: "{{ctx.relicId}}",
};

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(12).toString("hex").slice(0, 21 - ts.length);
  return `c${ts}${rand}`.padEnd(25, "0").slice(0, 25);
}

async function ensureSkill(
  prisma: PrismaClient,
  spec: typeof SKILL_FAL_CUTOUT | typeof SKILL_SAVE_ASSET_ENHANCED,
): Promise<string> {
  const existing = await prisma.skill.findUnique({ where: { slug: spec.slug } });
  if (existing) {
    await prisma.skill.update({
      where: { id: existing.id },
      data: {
        handlerConfig: spec.handlerConfig,
        nameEn: spec.nameEn,
        nameZh: spec.nameZh,
        descriptionEn: spec.descriptionEn,
        descriptionZh: spec.descriptionZh,
        kind: spec.kind,
        status: "ONLINE",
      },
    });
    console.log(`[migrate-cutout-forge] skill "${spec.slug}" exists (${existing.id}); healed config`);
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
  console.log(`[migrate-cutout-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
}

async function ensureForgeAgent(
  prisma: PrismaClient,
  skillIds: { cutout: string; save: string },
): Promise<string> {
  const existing = await prisma.agent.findUnique({ where: { codename: NEW_AGENT_CODENAME } });
  if (existing) {
    // Heal stale shape: an env that ran the old 3-slot version still has
    // a slot-0 equip pointing at the now-deleted image-to-data-uri Skill,
    // and pipelineConfig may be the 3-node form. Force final shape.
    await prisma.agent.update({
      where: { id: existing.id },
      data: { pipelineConfig: FORGE_PIPELINE as unknown as Prisma.InputJsonValue },
    });
    const stale = await prisma.agentSkillEquip.deleteMany({
      where: { agentId: existing.id, slotIndex: 0 },
    });
    if (stale.count > 0) {
      console.log(`[migrate-cutout-forge] healed ${NEW_AGENT_CODENAME}: removed ${stale.count} stale slot-0 equip`);
    }
    for (const [slotIndex, skillId] of [[1, skillIds.cutout], [2, skillIds.save]] as const) {
      const eq = await prisma.agentSkillEquip.findFirst({
        where: { agentId: existing.id, slotIndex },
      });
      if (!eq) {
        await prisma.agentSkillEquip.create({
          data: { agentId: existing.id, skillId, slotIndex, unlocked: true },
        });
        console.log(`[migrate-cutout-forge] re-equipped ${NEW_AGENT_CODENAME} slot ${slotIndex}`);
      }
    }
    console.log(`[migrate-cutout-forge] agent ${NEW_AGENT_CODENAME} already exists (${existing.id}); ensured final shape`);
    return existing.id;
  }

  const id = genCuid();
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        id,
        codename: NEW_AGENT_CODENAME,
        codenameZh: "抠图熔炉",
        nameEn: "Cutout Forge",
        nameZh: "抠图熔炉",
        mode: "MECHANICAL",
        status: "ONLINE",
        avatarUrl: "/images/agent-control/avatars/placeholder.svg",
        descriptionEn:
          "Dedicated background-cutout agent. Linear chain: fal.ai BiRefNet → save asset. Image data URI pre-encoded by the trigger endpoint.",
        descriptionZh: "专职抠图代理人。线性链：fal.ai BiRefNet → 保存资产。图片 dataUri 由触发端点预编码。",
        capabilities: ["image-cutout"],
        pipelineConfig: FORGE_PIPELINE as unknown as Prisma.InputJsonValue,
        deployedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.agentSkillEquip.createMany({
      data: [
        { agentId: agent.id, skillId: skillIds.cutout, slotIndex: 1, unlocked: true },
        { agentId: agent.id, skillId: skillIds.save, slotIndex: 2, unlocked: true },
      ],
    });
    return agent;
  });
  console.log(`[migrate-cutout-forge] created agent ${NEW_AGENT_CODENAME} (${result.id}) + 2 equips`);
  return result.id;
}

async function rebindEnhance2dScene(prisma: PrismaClient, forgeAgentId: string): Promise<void> {
  const binding = await prisma.sceneBinding.findUnique({ where: { sceneKey: "relic.enhance2d" } });
  if (!binding) {
    console.log('[migrate-cutout-forge] SceneBinding "relic.enhance2d" not found — skipping rebind (run migrate-scene-bindings first)');
    return;
  }
  await prisma.sceneBinding.update({
    where: { sceneKey: "relic.enhance2d" },
    data: {
      agentId: forgeAgentId,
      inputMap: FORGE_INPUT_MAP_ENHANCE2D as unknown as Prisma.InputJsonValue,
      notes:
        "CUTOUT-FORGE-001 final shape: endpoint pre-encodes imageDataUri; DAG runs cutout → save (no toDataUri).",
    },
  });
  console.log("[migrate-cutout-forge] rebound relic.enhance2d → CUTOUT-FORGE-001 (final shape)");
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-cutout-forge] SceneBinding table absent — skip (run earlier migrations first)");
      return;
    }

    const cutoutId = await ensureSkill(prisma, SKILL_FAL_CUTOUT);
    const saveId = await ensureSkill(prisma, SKILL_SAVE_ASSET_ENHANCED);
    const forgeId = await ensureForgeAgent(prisma, {
      cutout: cutoutId,
      save: saveId,
    });
    await rebindEnhance2dScene(prisma, forgeId);
    console.log("[migrate-cutout-forge] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-cutout-forge] failed:", e);
  process.exit(1);
});
