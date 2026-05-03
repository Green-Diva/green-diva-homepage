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
  {
    slot: 5,
    slug: "echo-stone",
    nameEn: "Echo Stone",
    nameZh: "回声之石",
    classifEn: "RESONANCE · RELIC",
    classifZh: "共鸣 · 残响遗物",
    rarity: "RARE" as const,
    iconKey: "radio_button_checked",
    origin: "Resonance Chamber Δ-3",
    loreEn: "A crystallized memory fragment. When held in silence, it **whispers** coordinates of a forgotten archive.",
    loreZh: "结晶化的记忆碎片。在寂静中持握，它会**低语**一座遗忘档案库的坐标。",
    acquiredAt: new Date("2024-11-15"),
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
    origin: "Null-space between layers",
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
    origin: "Binding Hall, Sub-Layer 2",
    loreEn: "A broken half of an ancient binding sigil. Inert alone — **dangerous** when paired.",
    loreZh: "古代束缚符印的破损半片。单独无害——成对则**危险**。",
    acquiredAt: new Date("2025-01-08"),
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
    origin: "The Outer Meridian",
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
    origin: "Somnambulant Archive",
    loreEn: "Contains a pressed dream, folded seventeen times. **Do not open** during waking hours.",
    loreZh: "收藏一个折叠十七次的压缩梦境。**切勿**在清醒时刻打开。",
    acquiredAt: new Date("2025-03-22"),
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
    origin: "Bureaucratic Stratum III",
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
    origin: "Clock Tower Ruin",
    loreEn: "Looking through it shows the **same room, thirty years earlier**. Handle with archival gloves.",
    loreZh: "透过它可以看到**同一房间三十年前**的样子。请戴存档手套操作。",
    acquiredAt: new Date("2025-05-01"),
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
    origin: "Scarlet Protocol Division",
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
    origin: "Lamplighter's Quarter",
    loreEn: "Burns without fuel. Grows **dimmer** the closer you get to the truth.",
    loreZh: "无需燃料。越接近真相，光芒越**黯淡**。",
    acquiredAt: new Date("2024-07-11"),
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
    origin: "Midnight Observatory",
    loreEn: "Reflects not your face, but your **most recent regret**. Catalogued as psychohazard class-B.",
    loreZh: "映照的不是你的容颜，而是你**最近一次的悔恨**。已归类为心理危害 B 级。",
  },
];

const AGENT_SEEDS = [
  {
    codename: "DIVA-001",
    nameEn: "Neural Operator",
    nameZh: "神经网络接线员",
    classification: "TACTICAL",
    status: "ONLINE" as const,
    descriptionEn:
      "Primary interface to the Green Diva inference fabric. Handles low-latency cognition tasks across the sanctum.",
    descriptionZh:
      "通向绿色圣母推理织域的首要接口。在圣殿各处承担低延迟思辨任务。",
    syncLevel: 98.6,
    matrixLevel: 14,
    quickness: 82,
    intelligence: 95,
    neuralLink: 78,
    bioSync: 64,
    logic: 89,
    compassion: 71,
    availableAp: 4,
    skills: [
      { level: 1, icon: "bolt", nameEn: "Reflex Surge", nameZh: "反射激涌", kind: "PASSIVE", costAp: 1, descriptionEn: "Sharpen baseline response latency by 8%.", descriptionZh: "基础响应延迟提升 8%。", unlocked: true },
      { level: 2, icon: "psychology", nameEn: "Pattern Reader", nameZh: "模式解读", kind: "PASSIVE", costAp: 2, descriptionEn: "Improves inference on noisy inputs.", descriptionZh: "提升嘈杂输入下的推断能力。", unlocked: true },
      { level: 3, icon: "speed", nameEn: "Neural Overclock", nameZh: "神经超频", kind: "PASSIVE", costAp: 3, descriptionEn: "Boosts active-node processing by 15% at the cost of slight feedback decay.", descriptionZh: "提升活跃节点处理速度 15%，代价是轻微的反馈衰减。", unlocked: true },
      { level: 4, icon: "shield", nameEn: "Drift Shield", nameZh: "漂移护盾", kind: "ACTIVE", costAp: 4, descriptionEn: "Halts context drift in long sessions.", descriptionZh: "阻止长会话中的上下文漂移。", unlocked: false },
      { level: 5, icon: "hub", nameEn: "Hive Convergence", nameZh: "蜂巢汇流", kind: "ACTIVE", costAp: 5, descriptionEn: "Coordinates distributed agents through a shared scratchpad.", descriptionZh: "通过共享记事板协调分布式代理。", unlocked: false },
      { level: 6, icon: "lock", nameEn: "Sanctum Lock", nameZh: "圣殿封印", kind: "ULTIMATE", costAp: 8, descriptionEn: "Locks the agent's weights against runtime tampering.", descriptionZh: "在运行时锁定代理权重，防篡改。", unlocked: false },
    ],
    enabled: true,
    provider: "ECHO" as const,
    systemPrompt: "You are DIVA-001, a neural operator that helps prioritize tactical decisions inside the Green Diva sanctum.",
    inputSchemaJson: '{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"]}',
    outputSchemaJson: '{"type":"object","properties":{"echoed":{}}}',
  },
  {
    codename: "ORACLE-7",
    nameEn: "Seer Analyst",
    nameZh: "先知分析师",
    classification: "VISION",
    status: "STANDBY" as const,
    descriptionEn: "Long-horizon forecaster. Reads weak signals across logs and timelines.",
    descriptionZh: "长程预测者。在日志与时间线之间读取微弱信号。",
    syncLevel: 87.2,
    matrixLevel: 11,
    quickness: 70,
    intelligence: 92,
    neuralLink: 80,
    bioSync: 58,
    logic: 90,
    compassion: 65,
    availableAp: 2,
    skills: [
      { level: 1, icon: "visibility", nameEn: "Wide Aperture", nameZh: "广角洞察", kind: "PASSIVE", costAp: 1, descriptionEn: "Expands attention window over recent context.", descriptionZh: "拓展近期上下文的注意力窗口。", unlocked: true },
      { level: 2, icon: "timeline", nameEn: "Timeline Trace", nameZh: "时序追迹", kind: "PASSIVE", costAp: 2, descriptionEn: "Aligns events along a synthesized timeline.", descriptionZh: "沿合成时间线对齐事件。", unlocked: true },
      { level: 3, icon: "auto_graph", nameEn: "Trend Synthesis", nameZh: "趋势综合", kind: "PASSIVE", costAp: 3, descriptionEn: "Produces a single-line trend summary.", descriptionZh: "产出一行式趋势摘要。", unlocked: false },
      { level: 4, icon: "insights", nameEn: "Counter-Forecast", nameZh: "反向预测", kind: "ACTIVE", costAp: 4, descriptionEn: "Outputs the strongest contrarian view.", descriptionZh: "输出最强反向观点。", unlocked: false },
      { level: 5, icon: "model_training", nameEn: "Bayes Loop", nameZh: "贝叶斯环", kind: "ACTIVE", costAp: 5, descriptionEn: "Iterates posterior beliefs as new logs arrive.", descriptionZh: "随新日志到达迭代后验信念。", unlocked: false },
      { level: 6, icon: "stars", nameEn: "Star Reading", nameZh: "星象解读", kind: "ULTIMATE", costAp: 7, descriptionEn: "Issues a single high-conviction prophecy.", descriptionZh: "颁布一条高确信度预言。", unlocked: false },
    ],
    enabled: true,
    provider: "ECHO" as const,
    systemPrompt: "You are ORACLE-7, a seer analyst. Read weak signals and surface the most likely next outcome.",
    inputSchemaJson: '{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"]}',
  },
  {
    codename: "SERAPH-NODE",
    nameEn: "Data Guardian",
    nameZh: "数据守护者",
    classification: "SUPPORT",
    status: "STANDBY" as const,
    descriptionEn: "Watches integrity, redactions, and PII leakage across requests.",
    descriptionZh: "守护各请求的完整性、脱敏与个人数据泄露。",
    syncLevel: 91.0,
    matrixLevel: 9,
    quickness: 60,
    intelligence: 78,
    neuralLink: 70,
    bioSync: 88,
    logic: 84,
    compassion: 80,
    availableAp: 3,
    skills: [
      { level: 1, icon: "verified", nameEn: "Schema Witness", nameZh: "结构见证", kind: "PASSIVE", costAp: 1, descriptionEn: "Validates inputs against declared schemas.", descriptionZh: "按声明 schema 校验输入。", unlocked: true },
      { level: 2, icon: "shield", nameEn: "Redaction Veil", nameZh: "脱敏帷幕", kind: "PASSIVE", costAp: 2, descriptionEn: "Auto-redacts likely PII fields.", descriptionZh: "自动脱敏疑似个人数据字段。", unlocked: true },
      { level: 3, icon: "lock_person", nameEn: "Vault Liaison", nameZh: "圣库联络", kind: "ACTIVE", costAp: 3, descriptionEn: "Brokers vault read requests safely.", descriptionZh: "安全代理圣库读请求。", unlocked: false },
      { level: 4, icon: "policy", nameEn: "Policy Sentinel", nameZh: "策略哨兵", kind: "ACTIVE", costAp: 4, descriptionEn: "Blocks calls violating posted policies.", descriptionZh: "阻断违反明示策略的调用。", unlocked: false },
      { level: 5, icon: "history", nameEn: "Audit Echo", nameZh: "审计回响", kind: "ACTIVE", costAp: 5, descriptionEn: "Streams compact audit lines for ops review.", descriptionZh: "为运维评审流式输出紧凑审计行。", unlocked: false },
      { level: 6, icon: "gavel", nameEn: "Final Verdict", nameZh: "终审裁决", kind: "ULTIMATE", costAp: 8, descriptionEn: "Halts a request with an explicit, immutable verdict.", descriptionZh: "以明确不可改的裁决中断请求。", unlocked: false },
    ],
    enabled: true,
    provider: "ECHO" as const,
    systemPrompt: "You are SERAPH-NODE, a data guardian. Your job is to flag PII, schema mismatches, and policy issues.",
    inputSchemaJson: '{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"]}',
  },
  {
    codename: "CHOIR-13",
    nameEn: "Resonance Coordinator",
    nameZh: "共振协调者",
    classification: "SUPPORT",
    status: "OFFLINE" as const,
    descriptionEn: "Choreographs multi-agent rituals — fan-out, gather, reconcile.",
    descriptionZh: "编排多代理仪轨——分发、汇聚、调和。",
    syncLevel: 65.4,
    matrixLevel: 7,
    quickness: 75,
    intelligence: 80,
    neuralLink: 85,
    bioSync: 60,
    logic: 72,
    compassion: 78,
    availableAp: 5,
    skills: [
      { level: 1, icon: "groups", nameEn: "Fan-Out", nameZh: "齐声分发", kind: "ACTIVE", costAp: 2, descriptionEn: "Dispatches a task to N peer agents.", descriptionZh: "向 N 个对等代理派发任务。", unlocked: true },
      { level: 2, icon: "merge", nameEn: "Reconcile", nameZh: "和声调和", kind: "ACTIVE", costAp: 3, descriptionEn: "Merges N replies into a single answer.", descriptionZh: "将 N 个回复合并为单一答复。", unlocked: false },
      { level: 3, icon: "handshake", nameEn: "Consensus Pulse", nameZh: "共识脉动", kind: "ACTIVE", costAp: 4, descriptionEn: "Polls agents until majority converges.", descriptionZh: "轮询代理直至多数收敛。", unlocked: false },
      { level: 4, icon: "tune", nameEn: "Tempo Lock", nameZh: "节拍锁定", kind: "PASSIVE", costAp: 3, descriptionEn: "Throttles peer agents to a steady cadence.", descriptionZh: "将对等代理节流至稳定节拍。", unlocked: false },
      { level: 5, icon: "podcasts", nameEn: "Broadcast Choir", nameZh: "广播圣咏", kind: "ULTIMATE", costAp: 6, descriptionEn: "Broadcasts a directive across the entire fabric.", descriptionZh: "向整片织域广播指令。", unlocked: false },
      { level: 6, icon: "all_inclusive", nameEn: "Eternal Loop", nameZh: "永恒回环", kind: "ULTIMATE", costAp: 9, descriptionEn: "Maintains a self-healing agent loop indefinitely.", descriptionZh: "无限维持一个自愈代理回环。", unlocked: false },
    ],
    enabled: false,
    provider: "ECHO" as const,
    systemPrompt: "You are CHOIR-13, a resonance coordinator. Orchestrate multi-agent flows.",
    inputSchemaJson: '{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"]}',
  },
];

async function seedAgents(creatorId: string | null) {
  for (const a of AGENT_SEEDS) {
    const existing = await prisma.agent.findUnique({ where: { codename: a.codename } });
    if (existing) {
      await prisma.agent.update({
        where: { codename: a.codename },
        data: {
          nameEn: a.nameEn,
          nameZh: a.nameZh,
          classification: a.classification,
          status: a.status,
          descriptionEn: a.descriptionEn,
          descriptionZh: a.descriptionZh,
          syncLevel: a.syncLevel,
          matrixLevel: a.matrixLevel,
          quickness: a.quickness,
          intelligence: a.intelligence,
          neuralLink: a.neuralLink,
          bioSync: a.bioSync,
          logic: a.logic,
          compassion: a.compassion,
          skills: a.skills,
          availableAp: a.availableAp,
          enabled: a.enabled,
          provider: a.provider,
          systemPrompt: a.systemPrompt,
          inputSchemaJson: a.inputSchemaJson ?? null,
          outputSchemaJson: a.outputSchemaJson ?? null,
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
          classification: a.classification,
          status: a.status,
          descriptionEn: a.descriptionEn,
          descriptionZh: a.descriptionZh,
          syncLevel: a.syncLevel,
          matrixLevel: a.matrixLevel,
          quickness: a.quickness,
          intelligence: a.intelligence,
          neuralLink: a.neuralLink,
          bioSync: a.bioSync,
          logic: a.logic,
          compassion: a.compassion,
          skills: a.skills,
          availableAp: a.availableAp,
          enabled: a.enabled,
          provider: a.provider,
          systemPrompt: a.systemPrompt,
          inputSchemaJson: a.inputSchemaJson ?? null,
          outputSchemaJson: a.outputSchemaJson ?? null,
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
