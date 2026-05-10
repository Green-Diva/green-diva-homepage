// One-shot migration: provisions MESHY-FORGE-001 — a dedicated 3D agent
// that replaces RELIC-SCRIBE-001's slot-4 monolithic meshy-3d INTERNAL
// handler with a config-driven 3-skill chain (image-to-data-uri →
// HTTP_API meshy → HTTP_API save-asset). Phase 2.4.1 of the agent
// service buildout.
//
// What it creates (idempotent — checks for existing rows by slug/codename):
//   1. Skill "image-to-data-uri-relic"  (INTERNAL)
//   2. Skill "meshy-3d-http"            (HTTP_API submit + poll + download)
//   3. Skill "save-asset-relic"         (HTTP_API → /api/internal/save-asset
//                                        with _relicWriteback responseTransform)
//   4. Agent "MESHY-FORGE-001"          (MECHANICAL, 3-slot chain DAG)
//   5. AgentSkillEquip × 3              (slots 0,1,2 → the new skills)
//   6. SceneBinding update for relic.create3d → MESHY-FORGE-001
//      (preserves existing inputMap, just swaps agentId)
//
// Old RELIC-SCRIBE-001.slot[4] (meshy-3d INTERNAL) is LEFT IN PLACE so
// flipping the SceneBinding back during a rollback is admin-doable in
// /agent-control?tab=scenes without touching code.
//
// Required env: DATABASE_URL.

import { Prisma, PrismaClient, type AgentJobStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";

void (null as unknown as AgentJobStatus); // silence unused-import warning

const NEW_AGENT_CODENAME = "MESHY-FORGE-001";

const SKILL_DATA_URI = {
  slug: "image-to-data-uri-relic",
  nameEn: "Image → Data URI",
  nameZh: "图片→数据 URI",
  icon: "image",
  descriptionEn:
    "Reads a relic-relative image path and base64-encodes it as a data URI suitable for inlining in JSON request bodies (Meshy / fal / etc).",
  descriptionZh:
    "读取 relic 相对路径的图片，base64 编码为 data URI（可直接塞进 Meshy / fal 等接口的 JSON body）。",
  handlerKind: "INTERNAL" as const,
  handlerConfig: {
    handler: "image-to-data-uri",
    maxBytes: 25 * 1024 * 1024,
  } as Prisma.InputJsonValue,
};

const SKILL_MESHY_HTTP = {
  slug: "meshy-3d-http",
  nameEn: "Meshy 3D (HTTP)",
  nameZh: "Meshy 3D（HTTP）",
  icon: "view_in_ar",
  descriptionEn:
    "Submits a Meshy image-to-3D task, polls until SUCCEEDED, downloads the GLB. All knobs (URL, polling interval, model defaults) live in handlerConfig — change them without commit.",
  descriptionZh:
    "提交 Meshy image-to-3D 任务、轮询至 SUCCEEDED、下载 GLB。URL/轮询间隔/默认模型参数全在 handlerConfig，改动不需要 commit。",
  handlerKind: "HTTP_API" as const,
  handlerConfig: {
    method: "POST",
    url: "https://api.meshy.ai/openapi/v1/image-to-3d",
    authEnv: "MESHY_API_KEY",
    authScheme: "Bearer",
    timeoutMs: 60_000,
    bodyTemplate: {
      // Input shape (from upstream image-to-data-uri merged with agent.input
      // opts): { dataUri, opts: { enablePbr, hdTexture, ... } }
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
      timeoutMs: 5 * 60_000,
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
    // Trim the response so downstream save-asset only sees the bits it
    // needs. _download is preserved verbatim.
    responseTransform: {
      _download: "{{response._download}}",
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
  handlerKind: "HTTP_API" as const,
  handlerConfig: {
    method: "POST",
    // Same-process server-to-server. Configurable per env if you ever
    // want to call across workers.
    url: "http://localhost:3000/api/internal/save-asset",
    authEnv: "INTERNAL_SERVICE_TOKEN",
    authScheme: "Header",
    authHeader: "X-Internal-Token",
    timeoutMs: 30_000,
    // Input shape (merged from agent.input + meshy output):
    //   { relicSlug, relicId, kind, _download: { base64, contentType } }
    bodyTemplate: {
      relicSlug: "{{relicSlug}}",
      kind: "{{kind}}",
      base64: "{{_download.base64}}",
      contentType: "{{_download.contentType}}",
    },
    // Wrap the savedPath into _relicWriteback so the runner's data-driven
    // hook (lib/skills/runtime/runner.ts) auto-updates Relic.modelPath.
    // The writeback field name is taken from input.writebackField so the
    // same skill can serve both 2D-enhance (enhancedImagePath) and 3D-
    // create (modelPath) modes — Phase 2.4.2 will reuse this.
    responseTransform: {
      savedPath: "{{response.savedPath}}",
      bytes: "{{response.bytes}}",
      _relicWriteback: {
        id: "{{input.relicId}}",
        fields: {
          // dynamic field name via key-from-input would require a richer
          // template engine; for now the 3D agent hardcodes "modelPath"
          // and the future cutout agent will hardcode "enhancedImagePath".
          modelPath: "{{response.savedPath}}",
        },
      },
    },
  } as Prisma.InputJsonValue,
};

// MESHY-FORGE-001 backbone DAG (v2): linear chain.
//   agent.input → toDataUri → meshy → save
const FORGE_PIPELINE = {
  version: 2 as const,
  nodes: [
    {
      id: "toDataUri",
      type: "skill" as const,
      equipSlot: 0,
      inputFrom: "agent.input",
      position: { x: 60, y: 200 },
    },
    {
      id: "meshy",
      type: "skill" as const,
      equipSlot: 1,
      // Merge: dataUri (from prior step) + opts (from agent.input). Without
      // merge, meshy would only see the data URI and miss the PBR / HD /
      // etc. Meshy options the trigger endpoint plumbed through.
      inputFrom: {
        merge: {
          dataUri: "toDataUri.output.dataUri",
          opts: "agent.input",
        },
      },
      position: { x: 380, y: 200 },
    },
    {
      id: "save",
      type: "skill" as const,
      equipSlot: 2,
      // save needs: _download (from meshy), relicSlug + relicId + kind
      // (from agent.input). agent.input must include these — see the
      // SceneBinding inputMap update below.
      inputFrom: {
        merge: {
          _download: "meshy.output._download",
          relicSlug: "agent.input.relicSlug",
          relicId: "agent.input._relicId",
          kind: "agent.input.kind",
        },
      },
      position: { x: 700, y: 200 },
    },
  ],
  edges: [
    { from: "toDataUri", to: "meshy" },
    { from: "meshy", to: "save" },
  ],
};

// New SceneBinding inputMap for relic.create3d → MESHY-FORGE-001.
// Differences from the legacy SCRIBE binding:
//   - drops `mode` (FORGE only does one thing — no mode router)
//   - drops `relicSlug` rename (preserved as-is)
//   - adds `kind: "model"` so the save-asset skill knows to write modelPath
//   - keeps Meshy opts spread (FORGE meshy skill reads them under {{opts}})
const FORGE_INPUT_MAP_CREATE3D = {
  relicSlug: "{{ctx.relicSlug}}",
  imagePath: "{{ctx.enhancedImagePath}}",
  _relicId: "{{ctx.relicId}}",
  kind: "model",
  // Meshy options. The new HTTP_API skill reads `opts.X`, not flat fields.
  opts: "{{ctx.opts}}",
};

function genCuid(): string {
  // c + 24 chars: time-based prefix + random tail. Mimics @prisma/cuid
  // closely enough for our use (uniqueness within a single migration).
  const ts = Date.now().toString(36);
  const rand = randomBytes(12).toString("hex").slice(0, 21 - ts.length);
  return `c${ts}${rand}`.padEnd(25, "0").slice(0, 25);
}

async function ensureSkill(
  prisma: PrismaClient,
  spec: typeof SKILL_DATA_URI | typeof SKILL_MESHY_HTTP | typeof SKILL_SAVE_ASSET,
): Promise<string> {
  const existing = await prisma.skill.findUnique({ where: { slug: spec.slug } });
  if (existing) {
    console.log(`[migrate-meshy-forge] skill "${spec.slug}" already exists (${existing.id}); skipping`);
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
  console.log(`[migrate-meshy-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
}

async function ensureForgeAgent(
  prisma: PrismaClient,
  skillIds: { dataUri: string; meshy: string; save: string },
): Promise<string> {
  const existing = await prisma.agent.findUnique({ where: { codename: NEW_AGENT_CODENAME } });
  if (existing) {
    console.log(`[migrate-meshy-forge] agent ${NEW_AGENT_CODENAME} already exists (${existing.id}); skipping creation`);
    return existing.id;
  }

  // Create agent + 3 equips in a single transaction so we never end up
  // with an agent that has the wrong number of equips.
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
          "Dedicated 3D-generation agent. Linear chain: image → Meshy task → save asset.",
        descriptionZh: "专职 3D 生成代理人。线性链：图片 → Meshy 任务 → 保存资产。",
        capabilities: ["model-3d-generation", "image-cutout"],
        pipelineConfig: FORGE_PIPELINE as unknown as Prisma.InputJsonValue,
        deployedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.agentSkillEquip.createMany({
      data: [
        { agentId: agent.id, skillId: skillIds.dataUri, slotIndex: 0, unlocked: true },
        { agentId: agent.id, skillId: skillIds.meshy, slotIndex: 1, unlocked: true },
        { agentId: agent.id, skillId: skillIds.save, slotIndex: 2, unlocked: true },
      ],
    });
    return agent;
  });
  console.log(`[migrate-meshy-forge] created agent ${NEW_AGENT_CODENAME} (${result.id}) + 3 equips`);
  return result.id;
}

async function rebindCreate3dScene(prisma: PrismaClient, forgeAgentId: string): Promise<void> {
  const binding = await prisma.sceneBinding.findUnique({ where: { sceneKey: "relic.create3d" } });
  if (!binding) {
    console.log('[migrate-meshy-forge] SceneBinding "relic.create3d" not found — skipping rebind (run migrate-scene-bindings first)');
    return;
  }
  if (binding.agentId === forgeAgentId) {
    console.log('[migrate-meshy-forge] relic.create3d already points at MESHY-FORGE-001; skipping');
    return;
  }
  await prisma.sceneBinding.update({
    where: { sceneKey: "relic.create3d" },
    data: {
      agentId: forgeAgentId,
      inputMap: FORGE_INPUT_MAP_CREATE3D as unknown as Prisma.InputJsonValue,
      notes:
        "Phase 2.4.1: routed to MESHY-FORGE-001 (image-to-data-uri → HTTP_API meshy → save-asset). Old RELIC-SCRIBE-001 slot 4 retained for rollback.",
    },
  });
  console.log("[migrate-meshy-forge] rebound relic.create3d → MESHY-FORGE-001");
}

async function main() {
  const prisma = new PrismaClient();
  try {
    // Sanity: SceneBinding table exists (means Phase 0a/0b have run)
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-meshy-forge] SceneBinding table absent — skip (run earlier migrations first)");
      return;
    }

    const dataUriId = await ensureSkill(prisma, SKILL_DATA_URI);
    const meshyId = await ensureSkill(prisma, SKILL_MESHY_HTTP);
    const saveId = await ensureSkill(prisma, SKILL_SAVE_ASSET);
    const forgeId = await ensureForgeAgent(prisma, {
      dataUri: dataUriId,
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
