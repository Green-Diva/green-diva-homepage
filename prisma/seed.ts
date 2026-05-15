import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";

function deriveTokenLookup(token: string): string {
  const secret = process.env.SAFETY_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SAFETY_SECRET missing or too short (>=16 chars) — required for token lookup");
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
    loreEn:
      "A vessel hewn from the moon-stained crystal of the Pthumerian dungeons. **Inscribed** with the sigils of the Old Blood — held by every initiate as a sign of pact.",
    loreZh:
      "镌自月光所染的伊布拉西亚地宫水晶。**铭刻**着旧血的符印，受戒者皆持之为契记。",
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
    password: "open-sesame",
  },
  {
    slot: 5,
    slug: "echo-stone",
    nameEn: "Echo Stone",
    nameZh: "回声之石",
    classifEn: "RESONANCE · RELIC",
    classifZh: "共鸣 · 残响遗物",
    rarity: "RARE" as const,
    iconKey: "radio_button_checked",
    loreEn: "A crystallized memory fragment. When held in silence, it **whispers** coordinates of a forgotten archive.",
    loreZh: "结晶化的记忆碎片。在寂静中持握，它会**低语**一座遗忘档案库的坐标。",
  },
  {
    slot: 6,
    slug: "phantom-thread",
    nameEn: "Phantom Thread",
    nameZh: "幻影丝线",
    classifEn: "SHADOW · WEAVE",
    classifZh: "暗影 · 编织残留",
    rarity: "EPIC" as const,
    iconKey: "timeline",
    loreEn: "Extracted from the seam of two collapsed realities. Grants passage through **semi-permeable** membranes.",
    loreZh: "从两个坍缩现实的缝隙中提取。赋予穿越**半透明**隔膜的通行权。",
  },
  {
    slot: 7,
    slug: "sigil-shard",
    nameEn: "Sigil Shard",
    nameZh: "符印碎晶",
    classifEn: "ARCANE · BINDING",
    classifZh: "秘法 · 束缚符文",
    rarity: "COMMON" as const,
    iconKey: "star_half",
    loreEn: "A broken half of an ancient binding sigil. Inert alone — **dangerous** when paired.",
    loreZh: "古代束缚符印的破损半片。单独无害——成对则**危险**。",
  },
  {
    slot: 9,
    slug: "null-compass",
    nameEn: "Null Compass",
    nameZh: "虚无罗盘",
    classifEn: "NAVIGATION · VOID",
    classifZh: "导航 · 虚空指向",
    rarity: "LEGENDARY" as const,
    iconKey: "explore",
    loreEn: "Points not north, but toward the **nearest absence**. Indispensable for deep-void traversal.",
    loreZh: "指向的不是北方，而是**最近的虚无**。深空穿越不可或缺。",
  },
  {
    slot: 10,
    slug: "dream-vessel",
    nameEn: "Dream Vessel",
    nameZh: "梦境容器",
    classifEn: "ONEIRIC · CONTAINMENT",
    classifZh: "梦境 · 封存容器",
    rarity: "RARE" as const,
    iconKey: "nightlight",
    loreEn: "Contains a pressed dream, folded seventeen times. **Do not open** during waking hours.",
    loreZh: "收藏一个折叠十七次的压缩梦境。**切勿**在清醒时刻打开。",
  },
  {
    slot: 11,
    slug: "iron-seal",
    nameEn: "Iron Seal",
    nameZh: "铁质封章",
    classifEn: "AUTH · ADMIN",
    classifZh: "认证 · 管理印鉴",
    rarity: "EPIC" as const,
    iconKey: "verified",
    loreEn: "Grants **administrative clearance** in the middle strata. Heavier than it appears.",
    loreZh: "赋予中间层的**管理权限**。比看起来更重。",
  },
  {
    slot: 12,
    slug: "temporal-lens",
    nameEn: "Temporal Lens",
    nameZh: "时序透镜",
    classifEn: "TIME · OPTICS",
    classifZh: "时间 · 光学器件",
    rarity: "SPECIAL" as const,
    iconKey: "schedule",
    loreEn: "Looking through it shows the **same room, thirty years earlier**. Handle with archival gloves.",
    loreZh: "透过它可以看到**同一房间三十年前**的样子。请戴存档手套操作。",
  },
  {
    slot: 13,
    slug: "crimson-cipher",
    nameEn: "Crimson Cipher",
    nameZh: "赤炎密码牌",
    classifEn: "CRYPTO · SCARLET",
    classifZh: "密码 · 赤炎令牌",
    rarity: "LEGENDARY" as const,
    iconKey: "token",
    loreEn: "One-time cipher used in the **Great Purge of Cycle 9**. Still active. Do not scan.",
    loreZh: "用于**第九轮回大清洗**的一次性密码牌。仍处于激活状态。请勿扫描。",
  },
  {
    slot: 14,
    slug: "pale-lantern",
    nameEn: "Pale Lantern",
    nameZh: "苍白灯笼",
    classifEn: "LIGHT · GUIDE",
    classifZh: "光源 · 引路之灯",
    rarity: "COMMON" as const,
    iconKey: "light_mode",
    loreEn: "Burns without fuel. Grows **dimmer** the closer you get to the truth.",
    loreZh: "无需燃料。越接近真相，光芒越**黯淡**。",
  },
  {
    slot: 15,
    slug: "obsidian-mirror",
    nameEn: "Obsidian Mirror",
    nameZh: "黑曜石镜",
    classifEn: "SCRYING · DARK",
    classifZh: "占卜 · 暗面凝视",
    rarity: "EPIC" as const,
    iconKey: "visibility",
    loreEn: "Reflects not your face, but your **most recent regret**. Catalogued as psychohazard class-B.",
    loreZh: "映照的不是你的容颜，而是你**最近一次的悔恨**。已归类为心理危害 B 级。",
  },
];

const AGENT_SEEDS = [
  {
    codename: "DIVA-001",
    nameEn: "Neural Operator",
    nameZh: "神经网络接线员",
    mode: "MECHANICAL" as const,
    status: "DEPLOYED" as const,
    syncLevel: 98.6,
    matrixLevel: 14,
    quickness: 82,
    intelligence: 95,
    neuralLink: 78,
    bioSync: 64,
    logic: 89,
    compassion: 71,
    availableAp: 4,
  },
  {
    codename: "ORACLE-7",
    nameEn: "Seer Analyst",
    nameZh: "先知分析师",
    mode: "MECHANICAL" as const,
    status: "STANDBY" as const,
    syncLevel: 87.2,
    matrixLevel: 11,
    quickness: 70,
    intelligence: 92,
    neuralLink: 80,
    bioSync: 58,
    logic: 90,
    compassion: 65,
    availableAp: 2,

  },
  {
    codename: "SERAPH-NODE",
    nameEn: "Data Guardian",
    nameZh: "数据守护者",
    mode: "MECHANICAL" as const,
    status: "STANDBY" as const,
    syncLevel: 91.0,
    matrixLevel: 9,
    quickness: 60,
    intelligence: 78,
    neuralLink: 70,
    bioSync: 88,
    logic: 84,
    compassion: 80,
    availableAp: 3,

  },
  {
    codename: "CHOIR-13",
    nameEn: "Resonance Coordinator",
    nameZh: "共振协调者",
    mode: "MECHANICAL" as const,
    status: "OFFLINE" as const,
    syncLevel: 65.4,
    matrixLevel: 7,
    quickness: 75,
    intelligence: 80,
    neuralLink: 85,
    bioSync: 60,
    logic: 72,
    compassion: 78,
    availableAp: 5,

  },
  {
    codename: "AURORA-Φ",
    nameEn: "Sovereign Strategos",
    nameZh: "自主策动师",
    mode: "AUTONOMOUS" as const,
    status: "STANDBY" as const,
    syncLevel: 87.4,
    matrixLevel: 11,
    quickness: 73,
    intelligence: 96,
    neuralLink: 91,
    bioSync: 58,
    logic: 94,
    compassion: 65,
    availableAp: 6,

  },
];

async function seedAgents(creatorId: string | null) {
  const DEFAULT_AVATAR = "/images/agent-control/avatars/default.svg";
  for (const a of AGENT_SEEDS) {
    const existing = await prisma.agent.findUnique({ where: { codename: a.codename } });
    if (existing) {
      await prisma.agent.update({
        where: { codename: a.codename },
        data: {
          nameEn: a.nameEn,
          nameZh: a.nameZh,
          mode: a.mode,
          status: a.status,
          avatarUrl: existing.avatarUrl || DEFAULT_AVATAR,
          syncLevel: a.syncLevel,
          matrixLevel: a.matrixLevel,
          availableAp: a.availableAp,

        },
      });
    } else {
      const max = await prisma.agent.aggregate({ _max: { serial: true } });
      const nextSerial = (max._max.serial ?? 0) + 1;
      await prisma.agent.create({
        data: {
          serial: nextSerial,
          codename: a.codename,
          nameEn: a.nameEn,
          nameZh: a.nameZh,
          mode: a.mode,
          status: a.status,
          avatarUrl: DEFAULT_AVATAR,
          syncLevel: a.syncLevel,
          matrixLevel: a.matrixLevel,
          availableAp: a.availableAp,

          createdById: creatorId,
        },
      });
    }
  }
  console.log(`Seeded ${AGENT_SEEDS.length} agents (provider=ECHO, no external API calls).`);
}

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
        loreEn: r.loreEn ?? null,
        loreZh: r.loreZh ?? null,
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
        loreEn: r.loreEn ?? null,
        loreZh: r.loreZh ?? null,
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
  let adminId: string | null = null;
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && adminToken !== "change-me-to-a-long-random-string") {
    const tokenLookup = deriveTokenLookup(adminToken);
    const tokenHash = await bcrypt.hash(adminToken, 12);
    const admin = await prisma.user.upsert({
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
      select: { id: true },
    });
    adminId = admin.id;
    console.log("Seeded High Lord (level 100) from ADMIN_TOKEN");
  } else {
    console.warn("ADMIN_TOKEN not set or default; skipping High Priestess seed");
  }

  await seedRelics();
  await seedAgents(adminId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
