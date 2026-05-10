// One-shot migration: provisions MESHY-FORGE-001 — a dedicated 3D agent
// implemented as a 2-skill chain (HTTP_API meshy → HTTP_API save-asset).
// The image data URI is pre-encoded by the trigger endpoint
// (lib/relics/readImageAsDataUri.ts) and passed in via SceneBinding ctx
// → agent.input.imageDataUri. The forge DAG never touches the file
// system; "agent = AI/external API only, IO = endpoint/pipeline layer".
//
// What it creates (idempotent — checks for existing rows by slug/codename):
//   1. Skill "meshy-3d-http"            (HTTP_API submit + poll + download)
//   2. Skill "save-asset-relic"         (HTTP_API → /api/internal/save-asset
//                                        with _relicWriteback responseTransform)
//   3. Agent "MESHY-FORGE-001"          (MECHANICAL, 2-slot chain DAG)
//   4. AgentSkillEquip × 2              (slots 1,2 → the new skills)
//   5. SceneBinding update for relic.create3d → MESHY-FORGE-001
//      (always written so re-runs heal stale legacy inputMap shapes)
//
// Required env: DATABASE_URL.

import { Prisma, PrismaClient, type AgentJobStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";

void (null as unknown as AgentJobStatus); // silence unused-import warning

const NEW_AGENT_CODENAME = "MESHY-FORGE-001";

const SKILL_MESHY_HTTP = {
  slug: "meshy-3d-http",
  nameEn: "Meshy 3D (HTTP)",
  nameZh: "Meshy 3D（HTTP）",
  icon: "view_in_ar",
  descriptionEn:
    "Submits a Meshy image-to-3D task, polls until SUCCEEDED, downloads the GLB. All knobs (URL, polling interval, model defaults) live in handlerConfig — change them without commit.",
  descriptionZh:
    "提交 Meshy image-to-3D 任务、轮询至 SUCCEEDED、下载 GLB。URL/轮询间隔/默认模型参数全在 handlerConfig，改动不需要 commit。",
  kind: "HTTP_API" as const,
  handlerConfig: {
    method: "POST",
    url: "https://api.meshy.ai/openapi/v1/image-to-3d",
    authEnv: "MESHY_API_KEY",
    authScheme: "Bearer",
    timeoutMs: 60_000,
    bodyTemplate: {
      // Input shape (from agent.input merged with opts):
      //   { dataUri, opts: { enablePbr, hdTexture, ... } }
      image_url: "{{dataUri}}",
      ai_model: "meshy-6",
      enable_pbr: "{{opts.enablePbr}}",
      hd_texture: "{{opts.hdTexture}}",
      auto_size: "{{opts.autoSize}}",
      target_formats: "{{opts.targetFormats}}",
      texture_prompt: "{{opts.texturePrompt}}",
      target_polycount: "{{opts.targetPolycount}}",
      symmetry_mode: "{{opts.symmetryMode}}",
      model_type: "{{opts.modelType}}",
    },
    polling: {
      url: "https://api.meshy.ai/openapi/v1/image-to-3d/{{response.result}}",
      method: "GET",
      intervalMs: 10_000,
      timeoutMs: 15 * 60_000,
      successWhen: { path: "status", equals: "SUCCEEDED" },
      failureWhen: [
        { path: "status", equals: "FAILED" },
        { path: "status", equals: "EXPIRED" },
        { path: "status", equals: "CANCELED" },
      ],
    },
    download: {
      urlPath: "model_urls.glb",
      field: "_download",
      maxBytes: 50 * 1024 * 1024,
    },
    responseTransform: {
      downloadBase64: "{{response._download.base64}}",
      downloadContentType: "{{response._download.contentType}}",
      taskId: "{{response.id}}",
      previewImageUrl: "{{response.thumbnail_url}}",
    },
  } as Prisma.InputJsonValue,
};

const SKILL_SAVE_ASSET = {
  slug: "save-asset-relic",
  nameEn: "Save Relic Asset",
  nameZh: "保存 relic 资产",
  icon: "save",
  descriptionEn:
    "POSTs a base64 blob to the main app's /api/internal/save-asset endpoint and emits the _relicWriteback shape so runner persists the path to Relic.modelPath / enhancedImagePath etc.",
  descriptionZh:
    "把 base64 blob POST 到主站 /api/internal/save-asset，并产出 _relicWriteback 字段让 runner 自动写回 Relic.modelPath / enhancedImagePath 等列。",
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
      kind: "{{kind}}",
      base64: "{{downloadBase64}}",
      contentType: "{{downloadContentType}}",
    },
    responseTransform: {
      savedPath: "{{response.savedPath}}",
      bytes: "{{response.bytes}}",
      _relicWriteback: {
        id: "{{input.relicId}}",
        fields: {
          modelPath: "{{response.savedPath}}",
        },
      },
    },
  } as Prisma.InputJsonValue,
};

// MESHY-FORGE-001 backbone DAG (v2 final): 2-node linear chain.
//   agent.input.imageDataUri → meshy-3d → save
const FORGE_PIPELINE = {
  version: 2 as const,
  nodes: [
    {
      id: "meshy-3d",
      type: "skill" as const,
      equipSlot: 1,
      inputFrom: {
        merge: {
          dataUri: "agent.input.imageDataUri",
          opts: "agent.input.opts",
        },
      },
      position: { x: 60, y: 200 },
    },
    {
      id: "save",
      type: "skill" as const,
      equipSlot: 2,
      inputFrom: {
        merge: {
          downloadBase64: "meshy-3d.output.downloadBase64",
          downloadContentType: "meshy-3d.output.downloadContentType",
          relicSlug: "agent.input.relicSlug",
          relicId: "agent.input._relicId",
          kind: "agent.input.kind",
          taskId: "meshy-3d.output.taskId",
          previewImageUrl: "meshy-3d.output.previewImageUrl",
        },
      },
      position: { x: 380, y: 200 },
    },
  ],
  edges: [{ from: "meshy-3d", to: "save" }],
};

// SceneBinding inputMap for relic.create3d → MESHY-FORGE-001.
//   - imageDataUri pre-encoded by the trigger endpoint
//   - kind hardcoded to "model" so save-asset writes Relic.modelPath
//   - opts spread via {{ctx.opts}}
const FORGE_INPUT_MAP_CREATE3D = {
  relicSlug: "{{ctx.relicSlug}}",
  imageDataUri: "{{ctx.imageDataUri}}",
  _relicId: "{{ctx.relicId}}",
  kind: "model",
  opts: "{{ctx.opts}}",
};

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(12).toString("hex").slice(0, 21 - ts.length);
  return `c${ts}${rand}`.padEnd(25, "0").slice(0, 25);
}

async function ensureSkill(
  prisma: PrismaClient,
  spec: typeof SKILL_MESHY_HTTP | typeof SKILL_SAVE_ASSET,
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
    console.log(`[migrate-meshy-forge] skill "${spec.slug}" exists (${existing.id}); healed config`);
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
  console.log(`[migrate-meshy-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
}

async function ensureForgeAgent(
  prisma: PrismaClient,
  skillIds: { meshy: string; save: string },
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
      console.log(`[migrate-meshy-forge] healed ${NEW_AGENT_CODENAME}: removed ${stale.count} stale slot-0 equip`);
    }
    // Make sure slots 1 & 2 are equipped (in case the env never had them).
    for (const [slotIndex, skillId] of [[1, skillIds.meshy], [2, skillIds.save]] as const) {
      const eq = await prisma.agentSkillEquip.findFirst({
        where: { agentId: existing.id, slotIndex },
      });
      if (!eq) {
        await prisma.agentSkillEquip.create({
          data: { agentId: existing.id, skillId, slotIndex, unlocked: true },
        });
        console.log(`[migrate-meshy-forge] re-equipped ${NEW_AGENT_CODENAME} slot ${slotIndex}`);
      }
    }
    console.log(`[migrate-meshy-forge] agent ${NEW_AGENT_CODENAME} already exists (${existing.id}); ensured final shape`);
    return existing.id;
  }

  const id = genCuid();
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        id,
        codename: NEW_AGENT_CODENAME,
        codenameZh: "梅希熔炉",
        nameEn: "Meshy Forge",
        nameZh: "梅希熔炉",
        mode: "MECHANICAL",
        status: "ONLINE",
        avatarUrl: "/images/agent-control/avatars/placeholder.svg",
        descriptionEn:
          "Dedicated 3D-generation agent. Linear chain: Meshy task → save asset. Image data URI pre-encoded by the trigger endpoint.",
        descriptionZh: "专职 3D 生成代理人。线性链：Meshy 任务 → 保存资产。图片 dataUri 由触发端点预编码。",
        capabilities: ["model-3d-generation", "image-cutout"],
        pipelineConfig: FORGE_PIPELINE as unknown as Prisma.InputJsonValue,
        deployedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.agentSkillEquip.createMany({
      data: [
        { agentId: agent.id, skillId: skillIds.meshy, slotIndex: 1, unlocked: true },
        { agentId: agent.id, skillId: skillIds.save, slotIndex: 2, unlocked: true },
      ],
    });
    return agent;
  });
  console.log(`[migrate-meshy-forge] created agent ${NEW_AGENT_CODENAME} (${result.id}) + 2 equips`);
  return result.id;
}

async function rebindCreate3dScene(prisma: PrismaClient, forgeAgentId: string): Promise<void> {
  const binding = await prisma.sceneBinding.findUnique({ where: { sceneKey: "relic.create3d" } });
  if (!binding) {
    console.log('[migrate-meshy-forge] SceneBinding "relic.create3d" not found — skipping rebind (run migrate-scene-bindings first)');
    return;
  }
  // Always write — keeps stale inputMap shapes in legacy environments
  // honest. The write is idempotent; same final shape every time.
  await prisma.sceneBinding.update({
    where: { sceneKey: "relic.create3d" },
    data: {
      agentId: forgeAgentId,
      inputMap: FORGE_INPUT_MAP_CREATE3D as unknown as Prisma.InputJsonValue,
      notes:
        "MESHY-FORGE-001 final shape: endpoint pre-encodes imageDataUri; DAG runs meshy-3d → save (no toDataUri).",
    },
  });
  console.log("[migrate-meshy-forge] rebound relic.create3d → MESHY-FORGE-001 (final shape)");
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-meshy-forge] SceneBinding table absent — skip (run earlier migrations first)");
      return;
    }

    const meshyId = await ensureSkill(prisma, SKILL_MESHY_HTTP);
    const saveId = await ensureSkill(prisma, SKILL_SAVE_ASSET);
    const forgeId = await ensureForgeAgent(prisma, {
      meshy: meshyId,
      save: saveId,
    });
    await rebindCreate3dScene(prisma, forgeId);
    console.log("[migrate-meshy-forge] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-meshy-forge] failed:", e);
  process.exit(1);
});
