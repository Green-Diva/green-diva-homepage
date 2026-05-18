// Seeds the fal-cutout-http skill used in the 2D-enhance chain.
//
// 2026-05-12: this script USED to also create CUTOUT-FORGE-001 + bind
// relic.enhance2d + seed a sibling `save-asset-enhanced` skill. Those
// responsibilities moved to migrate-relic-forge.ts when the three forge
// agents were collapsed into a single RELIC-FORGE-001. `save-asset-enhanced`
// was retired (replaced by the reusable `save-asset-relic` with a
// templated `kind` field; cutout chain now sets kind="enhanced" via
// scene.prepareAgentInput). This script now only seeds fal-cutout-http.

import { Prisma, PrismaClient } from "@prisma/client";

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
      // Input shape (from agent.input via scene.prepareAgentInput, fanned
      // into this skill by RELIC-FORGE-001's `cutout` node inputFrom merge):
      //   { dataUri, model, operatingResolution, refineForeground }
      // fal expects snake_case — we translate from camelCase here. Admin
      // tweaks the values via app/admin/relics/Cutout2dConfigModal.tsx.
      image_url: "{{dataUri}}",
      model: "{{model}}",
      operating_resolution: "{{operatingResolution}}",
      refine_foreground: "{{refineForeground}}",
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
  inputSchema: {
    type: "object",
    properties: {
      dataUri: {
        type: "string",
        description: "Image as a data URI (data:image/<type>;base64,<...>). The image whose background should be removed.",
      },
      model: {
        type: "string",
        enum: [
          "General Use (Light)",
          "General Use (Light 2K)",
          "General Use (Heavy)",
          "Matting",
          "Portrait",
          "General Use (Dynamic)",
        ],
        description:
          "BiRefNet variant. Light = fast/cheap default; Heavy = ~2× cost, cleaner edges on complex materials; Matting = best for hair/feathers/mesh; Portrait = people; Dynamic = unlocks 2304 resolution.",
      },
      operatingResolution: {
        type: "string",
        enum: ["1024x1024", "2048x2048", "2304x2304"],
        description:
          "Inference resolution. Higher = better small-detail retention at higher time/VRAM cost. 2304x2304 only valid with the Dynamic model.",
      },
      refineForeground: {
        type: "boolean",
        description:
          "Second-pass foreground refinement for smoother edges and translucent transitions. Default true.",
      },
    },
    required: ["dataUri"],
  } as Prisma.InputJsonValue,
};

// 2026-05-12 — inputMap retired. ctx → agent.input is now owned by
// scene.prepareAgentInput in lib/relics/scenes.ts (relicEnhance2dScene).
// 2026-05-12 — CUTOUT-FORGE-001 agent itself absorbed into RELIC-FORGE-001
// (see migrate-relic-forge.ts). The DAG that used to be seeded from this
// file is now declared in that script. The fal-cutout-http skill spec
// remains here as its source of truth.

async function ensureSkill(
  prisma: PrismaClient,
  spec: typeof SKILL_FAL_CUTOUT,
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
      inputSchema: spec.inputSchema,
      status: "ONLINE",
    },
    select: { id: true },
  });
  console.log(`[migrate-cutout-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
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

    await ensureSkill(prisma, SKILL_FAL_CUTOUT);

    console.log("[migrate-cutout-forge] done (skill only — agent owned by migrate-relic-forge)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-cutout-forge] failed:", e);
  process.exit(1);
});
