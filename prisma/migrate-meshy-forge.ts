// Seeds the meshy-3d-http skill.
//
// 2026-05-12: this script USED to also create MESHY-FORGE-001 + bind
// relic.create3d. Those responsibilities moved to migrate-relic-forge.ts
// when the three forge agents were collapsed into a single
// RELIC-FORGE-001.
// 2026-05-13: save-asset-relic skill retired — replaced by the `persist`
// backbone primitive node type. The skill row + slot 5 equip + meshy
// DAG's save-meshy skill node are all reshaped by
// migrate-replace-save-asset.ts and migrate-relic-forge.ts.

import { Prisma, PrismaClient } from "@prisma/client";

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
  inputSchema: {
    type: "object",
    properties: {
      dataUri: { type: "string", description: "Source image as a data URI (typically the transparent PNG from CUTOUT)." },
      opts: {
        type: "object",
        description: "Meshy generation options. All optional.",
        properties: {
          enablePbr: { type: "boolean" },
          hdTexture: { type: "boolean" },
          autoSize: { type: "boolean" },
          targetFormats: { type: "array", items: { type: "string", enum: ["glb", "obj", "fbx", "stl", "usdz", "3mf"] } },
          texturePrompt: { type: "string" },
          targetPolycount: { type: "integer" },
          symmetryMode: { type: "string", enum: ["off", "auto", "on"] },
          modelType: { type: "string", enum: ["standard", "lowpoly"] },
        },
      },
    },
    required: ["dataUri"],
  } as Prisma.InputJsonValue,
};

// 2026-05-12 — inputMap retired. ctx → agent.input is now owned by
// scene.prepareAgentInput in lib/relics/scenes.ts (relicCreate3dScene
// injects `kind: "model"` + the _relicId envelope).
// 2026-05-12 — MESHY-FORGE-001 agent itself absorbed into RELIC-FORGE-001
// (see migrate-relic-forge.ts). The DAG that used to be seeded from this
// file is now declared in that script. Skill specs remain here as the
// source of truth for the meshy-3d-http + save-asset-relic tools.

async function ensureSkill(
  prisma: PrismaClient,
  spec: typeof SKILL_MESHY_HTTP,
): Promise<string> {
  const existing = await prisma.skill.findUnique({ where: { slug: spec.slug } });
  if (existing) {
    await prisma.skill.update({
      where: { id: existing.id },
      data: {
        handlerConfig: spec.handlerConfig,
        inputSchema: spec.inputSchema,
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
      inputSchema: spec.inputSchema,
      status: "ONLINE",
    },
    select: { id: true },
  });
  console.log(`[migrate-meshy-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
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

    await ensureSkill(prisma, SKILL_MESHY_HTTP);

    console.log("[migrate-meshy-forge] done (meshy-3d-http skill only — agent owned by migrate-relic-forge; persistence via backbone `persist` primitive)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-meshy-forge] failed:", e);
  process.exit(1);
});
