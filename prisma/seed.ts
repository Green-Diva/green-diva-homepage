import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";

function deriveTokenLookup(token: string): string {
  const secret = process.env.VAULT_COOKIE_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("VAULT_COOKIE_SECRET missing or too short (>=16 chars) — required for token lookup");
  }
  return createHmac("sha256", secret).update(token).digest("base64url");
}

const prisma = new PrismaClient();

const RELIC_SEEDS = [
  {
    slot: 1,
    slug: "holy-chalice",
    nameEn: "Holy Chalice",
    nameZh: "圣杯",
    classifEn: "BLOOD · GRAIL",
    classifZh: "血源诅咒 · 圣杯",
    rarity: "COMMON" as const,
    iconKey: "wine_bar",
    origin: "Yharnam Cathedral Ward",
    loreEn:
      "A vessel hewn from the moon-stained crystal of the Pthumerian dungeons. **Inscribed** with the sigils of the Old Blood — held by every initiate as a sign of pact.",
    loreZh:
      "镌自月光所染的伊布拉西亚地宫水晶。**铭刻**着旧血的符印，受戒者皆持之为契记。",
    acquiredAt: new Date("2024-09-01"),
  },
  {
    slot: 2,
    slug: "data-shard",
    nameEn: "Data Shard",
    nameZh: "数据碎片",
    classifEn: "CRYPT · SHARD",
    classifZh: "档案 · 加密残片",
    rarity: "RARE" as const,
    iconKey: "memory",
    origin: "Sub-Layer 7 cache",
    loreEn: "A shard from the sub-layer cache. Decryption requires apprenticeship beyond Tier 25.",
    loreZh: "源自次层缓存的残片。25 级以上方能解密。",
  },
  {
    slot: 3,
    slug: "core-node",
    nameEn: "Core Node",
    nameZh: "核心节点",
    classifEn: "INFRA · CORE",
    classifZh: "基础设施 · 关键",
    rarity: "EPIC" as const,
    iconKey: "hub",
    origin: "Citadel mainframe",
  },
  {
    slot: 4,
    slug: "void-sphere",
    nameEn: "Void Sphere",
    nameZh: "虚空之球",
    classifEn: "VOID · SEALED",
    classifZh: "异常 · 须严密封存",
    rarity: "LEGENDARY" as const,
    iconKey: "blur_circular",
    origin: "Outer Veil",
    loreEn: "A specimen of negative-mass curvature. **Direct exposure** is forbidden below Tier 75.",
    loreZh: "负质量曲率样本。75 级以下**禁止**直接接触。",
  },
  {
    slot: 8,
    slug: "frame-lock",
    nameEn: "Frame Lock",
    nameZh: "镜匣封印",
    classifEn: "ZERO · SHRINE",
    classifZh: "零 · 封印之匣",
    rarity: "SPECIAL" as const,
    iconKey: "frame_inspect",
    origin: "Himuro Mansion",
    password: "rite-of-the-veil",
    loreEn: "Sealed by a private rite. Only those who know the passphrase may unseal.",
    loreZh: "以私密之仪封缄。唯知其密语者可解。",
  },
  {
    slot: 22,
    slug: "access-key",
    nameEn: "Access Key",
    nameZh: "通行钥",
    classifEn: "SAFE · MASTER",
    classifZh: "安全 · 主钥筒",
    rarity: "SPECIAL" as const,
    iconKey: "key",
    origin: "Personal vault",
    password: "open-sesame",
  },
];

async function seedRelics() {
  for (const r of RELIC_SEEDS) {
    const passwordHash = r.password ? await bcrypt.hash(r.password, 12) : null;
    await prisma.relic.upsert({
      where: { slug: r.slug },
      update: {
        slot: r.slot,
        nameEn: r.nameEn,
        nameZh: r.nameZh,
        classifEn: r.classifEn,
        classifZh: r.classifZh,
        rarity: r.rarity,
        iconKey: r.iconKey,
        origin: r.origin ?? null,
        loreEn: r.loreEn ?? null,
        loreZh: r.loreZh ?? null,
        acquiredAt: r.acquiredAt ?? null,
        ...(passwordHash ? { passwordHash } : {}),
      },
      create: {
        slot: r.slot,
        slug: r.slug,
        nameEn: r.nameEn,
        nameZh: r.nameZh,
        classifEn: r.classifEn,
        classifZh: r.classifZh,
        rarity: r.rarity,
        iconKey: r.iconKey,
        origin: r.origin ?? null,
        loreEn: r.loreEn ?? null,
        loreZh: r.loreZh ?? null,
        acquiredAt: r.acquiredAt ?? null,
        passwordHash,
      },
    });
  }
  console.log(`Seeded ${RELIC_SEEDS.length} relics (passwords: rite-of-the-veil, open-sesame)`);
}

async function main() {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PROD_SEED) {
    throw new Error(
      "Refusing to seed in production. Set ALLOW_PROD_SEED=1 to override.",
    );
  }
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && adminToken !== "change-me-to-a-long-random-string") {
    const tokenLookup = deriveTokenLookup(adminToken);
    const tokenHash = await bcrypt.hash(adminToken, 12);
    await prisma.user.upsert({
      where: { tokenLookup },
      update: { level: 100, name: "High Lord", tokenHash },
      create: {
        tokenHash,
        tokenLookup,
        serial: 1,
        name: "High Lord",
        level: 100,
        attack: 82,
        defense: 74,
        hp: 90,
        agility: 66,
        luck: 78,
        specialAttributes: "Sigil-bound · Vault-keeper · Architect",
      },
    });
    console.log("Seeded High Lord (level 100) from ADMIN_TOKEN");
  } else {
    console.warn("ADMIN_TOKEN not set or default; skipping High Priestess seed");
  }

  await seedRelics();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
