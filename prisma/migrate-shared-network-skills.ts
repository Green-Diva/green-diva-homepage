// Provisions network-IO skills shared across multiple forges.
//
// Currently:
//   - download-network-image  — generic binary HTTP GET; consumed by
//                               LENS-FORGE-001 (and was originally created
//                               by migrate-picker-forge.ts before PICKER
//                               was retired 2026-05-14).
//
// Run before any forge migration that equips these skills (LENS, etc.).
// Idempotent: ensure semantics — heals handlerConfig + status if existing.
//
// Why this file exists:
//   2026-05-14 PICKER-FORGE-001 was permanently removed. Its migration used
//   to seed download-network-image, but LENS-FORGE-001 still needs it. To
//   avoid coupling LENS to a deleted migration, the shared skill moved here.
//   Future forges that need network-binary fetch should equip the existing
//   slug rather than redefining.

import { Prisma, PrismaClient } from "@prisma/client";

const SKILL_DOWNLOAD = {
  slug: "download-network-image",
  nameEn: "Download Network Image (binary)",
  nameZh: "下载网络图片(二进制)",
  icon: "download",
  descriptionEn:
    "GETs an arbitrary image URL and returns { base64, contentType, bytes, url }. No auth — used inside forEach loops by lens / picker / etc to fetch candidate images.",
  descriptionZh:
    "GET 任意图片 URL,返回 { base64, contentType, bytes, url }。无鉴权——在 forEach 循环里抓候选图,LENS / 未来的 picker 共用。",
  kind: "HTTP_API" as const,
  handlerConfig: {
    method: "GET",
    url: "{{url}}",
    responseType: "binary",
    binaryMaxBytes: 10 * 1024 * 1024,
    timeoutMs: 30_000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GreenDiva/1.0)",
    },
  } as Prisma.InputJsonValue,
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL of an image to fetch." },
    },
    required: ["url"],
  } as Prisma.InputJsonValue,
};

async function ensureSkill(prisma: PrismaClient, spec: typeof SKILL_DOWNLOAD): Promise<void> {
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
    console.log(
      `[migrate-shared-network-skills] skill "${spec.slug}" exists (${existing.id}); healed config`,
    );
    return;
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
  console.log(`[migrate-shared-network-skills] created skill ${spec.slug} (${created.id})`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Skill') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log(
        "[migrate-shared-network-skills] Skill table absent — skip (run earlier migrations first)",
      );
      return;
    }
    await ensureSkill(prisma, SKILL_DOWNLOAD);
    console.log("[migrate-shared-network-skills] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-shared-network-skills] failed:", e);
  process.exit(1);
});
