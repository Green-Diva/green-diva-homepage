// One-shot migration: provisions CUTOUT-FORGE-001 — a dedicated cutout
// agent that replaces RELIC-SCRIBE-001's slot-3 monolithic relic-cutout
// INTERNAL handler with the same 3-skill chain pattern as MESHY-FORGE
// (image-to-data-uri → HTTP_API fal-cutout → HTTP_API save-asset). Phase
// 2.4.2 of the agent service buildout.
//
// What it creates / does (idempotent):
//   1. Skill "fal-cutout-http"     (HTTP_API → fal.ai BiRefNet)
//   2. Skill "save-asset-enhanced" (HTTP_API → /api/internal/save-asset
//                                    with _relicWriteback into
//                                    enhancedImagePath)
//   3. Agent "CUTOUT-FORGE-001"    (MECHANICAL, reuses existing
//                                    image-to-data-uri-relic skill in slot 0)
//   4. AgentSkillEquip × 3
//   5. SceneBinding update for relic.enhance2d → CUTOUT-FORGE-001
//
// Old RELIC-SCRIBE-001.slot[3] (relic-cutout INTERNAL) is LEFT IN PLACE
// for rollback (admin can flip the SceneBinding back from /agent-control).
//
// Required env: DATABASE_URL.

import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const NEW_AGENT_CODENAME = "CUTOUT-FORGE-001";
const SHARED_DATA_URI_SLUG = "image-to-data-uri-relic"; // created by migrate-meshy-forge

const SKILL_FAL_CUTOUT = {
  slug: "fal-cutout-http",
  nameEn: "fal.ai Cutout (HTTP)",
  nameZh: "fal.ai 抠图（HTTP）",
  icon: "auto_fix_high",
  descriptionEn:
    "Submits a data-URI image to fal.ai's BiRefNet endpoint, downloads the resulting transparent PNG. URL / model / timeout are admin-editable in handlerConfig.",
  descriptionZh:
    "把 data URI 图片提交给 fal.ai BiRefNet，下载生成的透明 PNG。URL / 模型 / 超时全在 handlerConfig 可改。",
  handlerKind: "HTTP_API" as const,
  handlerConfig: {
    method: "POST",
    url: "https://fal.run/fal-ai/birefnet/v2",
    authEnv: "FAL_API_KEY",
    // fal.ai uses "Authorization: Key <key>" (not Bearer / ApiKey) — see
    // the new "Key" authScheme added to lib/skills/handlers/httpApi.ts.
    authScheme: "Key",
    timeoutMs: 60_000,
    bodyTemplate: {
      // Input shape (from upstream image-to-data-uri merged with agent.input):
      //   { dataUri }
      image_url: "{{dataUri}}",
    },
    // fal.run is synchronous (~10s) — no polling needed.
    download: {
      urlPath: "image.url",
      field: "_download",
      maxBytes: 25 * 1024 * 1024,
    },
    // Trim the response so save-asset only sees what it needs.
    responseTransform: {
      _download: "{{response._download}}",
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
  handlerKind: "HTTP_API" as const,
  handlerConfig: {
    method: "POST",
    url: "http://localhost:3000/api/internal/save-asset",
    authEnv: "INTERNAL_SERVICE_TOKEN",
    authScheme: "Header",
    authHeader: "X-Internal-Token",
    timeoutMs: 30_000,
    // Input merged from agent.input + cutout output:
    //   { relicSlug, relicId, _download: { base64, contentType } }
    bodyTemplate: {
      relicSlug: "{{relicSlug}}",
      kind: "enhanced",
      base64: "{{_download.base64}}",
      contentType: "{{_download.contentType}}",
    },
    responseTransform: {
      savedPath: "{{response.savedPath}}",
      bytes: "{{response.bytes}}",
      _relicWriteback: {
        id: "{{input.relicId}}",
        fields: {
          // Cutout-specific writeback target. The runner allowlist
          // (lib/skills/runtime/runner.ts ALLOWED_WRITEBACK_FIELDS)
          // includes enhancedImagePath.
          enhancedImagePath: "{{response.savedPath}}",
        },
      },
    },
  } as Prisma.InputJsonValue,
};

// CUTOUT-FORGE-001 backbone DAG (v2): linear chain identical in shape
// to MESHY-FORGE-001's, just different middle node.
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
      id: "cutout",
      type: "skill" as const,
      equipSlot: 1,
      inputFrom: {
        merge: {
          dataUri: "toDataUri.output.dataUri",
        },
      },
      position: { x: 380, y: 200 },
    },
    {
      id: "save",
      type: "skill" as const,
      equipSlot: 2,
      inputFrom: {
        merge: {
          _download: "cutout.output._download",
          relicSlug: "agent.input.relicSlug",
          relicId: "agent.input._relicId",
        },
      },
      position: { x: 700, y: 200 },
    },
  ],
  edges: [
    { from: "toDataUri", to: "cutout" },
    { from: "cutout", to: "save" },
  ],
};

const FORGE_INPUT_MAP_ENHANCE2D = {
  relicSlug: "{{ctx.relicSlug}}",
  imagePath: "{{ctx.primaryImagePath}}",
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
    console.log(`[migrate-cutout-forge] skill "${spec.slug}" already exists (${existing.id}); skipping`);
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
  console.log(`[migrate-cutout-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
}

async function lookupSharedSkill(prisma: PrismaClient, slug: string): Promise<string> {
  const row = await prisma.skill.findUnique({ where: { slug }, select: { id: true } });
  if (!row) {
    throw new Error(
      `[migrate-cutout-forge] expected shared skill "${slug}" to exist (run migrate-meshy-forge first)`,
    );
  }
  return row.id;
}

async function ensureForgeAgent(
  prisma: PrismaClient,
  skillIds: { dataUri: string; cutout: string; save: string },
): Promise<string> {
  const existing = await prisma.agent.findUnique({ where: { codename: NEW_AGENT_CODENAME } });
  if (existing) {
    console.log(`[migrate-cutout-forge] agent ${NEW_AGENT_CODENAME} already exists (${existing.id}); skipping creation`);
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
          "Dedicated background-cutout agent. Linear chain: image → fal.ai BiRefNet → save asset.",
        descriptionZh: "专职抠图代理人。线性链：图片 → fal.ai BiRefNet → 保存资产。",
        capabilities: ["image-cutout"],
        pipelineConfig: FORGE_PIPELINE as unknown as Prisma.InputJsonValue,
        deployedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.agentSkillEquip.createMany({
      data: [
        { agentId: agent.id, skillId: skillIds.dataUri, slotIndex: 0, unlocked: true },
        { agentId: agent.id, skillId: skillIds.cutout, slotIndex: 1, unlocked: true },
        { agentId: agent.id, skillId: skillIds.save, slotIndex: 2, unlocked: true },
      ],
    });
    return agent;
  });
  console.log(`[migrate-cutout-forge] created agent ${NEW_AGENT_CODENAME} (${result.id}) + 3 equips`);
  return result.id;
}

async function rebindEnhance2dScene(prisma: PrismaClient, forgeAgentId: string): Promise<void> {
  const binding = await prisma.sceneBinding.findUnique({ where: { sceneKey: "relic.enhance2d" } });
  if (!binding) {
    console.log('[migrate-cutout-forge] SceneBinding "relic.enhance2d" not found — skipping rebind (run migrate-scene-bindings first)');
    return;
  }
  if (binding.agentId === forgeAgentId) {
    console.log('[migrate-cutout-forge] relic.enhance2d already points at CUTOUT-FORGE-001; skipping');
    return;
  }
  await prisma.sceneBinding.update({
    where: { sceneKey: "relic.enhance2d" },
    data: {
      agentId: forgeAgentId,
      inputMap: FORGE_INPUT_MAP_ENHANCE2D as unknown as Prisma.InputJsonValue,
      notes:
        "Phase 2.4.2: routed to CUTOUT-FORGE-001 (image-to-data-uri → HTTP_API fal cutout → save-asset). Old RELIC-SCRIBE-001 slot 3 retained for rollback.",
    },
  });
  console.log("[migrate-cutout-forge] rebound relic.enhance2d → CUTOUT-FORGE-001");
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

    const dataUriId = await lookupSharedSkill(prisma, SHARED_DATA_URI_SLUG);
    const cutoutId = await ensureSkill(prisma, SKILL_FAL_CUTOUT);
    const saveId = await ensureSkill(prisma, SKILL_SAVE_ASSET_ENHANCED);
    const forgeId = await ensureForgeAgent(prisma, {
      dataUri: dataUriId,
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
