// One-off seed for the RELIC-SCRIBE-001 agent's skills (Phase 5+ flow).
// Idempotent — re-run safe (upserts by nameEn).
//
// Run: npx tsx prisma/seed-relic-scribe-skills.ts
//
// Skills produced:
//   slot 0  Relic Files Summary       (existing, INTERNAL)
//   slot 1  Relic Gemini Researcher   (NEW: Gemini + Google Search Grounding)
//   slot 2  Relic Smart Image Picker  (NEW: candidate set + SerpAPI for net images)
//   slot 3  Background Cutout         (NEW: fal.ai BiRefNet)
//   slot 4  Meshy 3D Generator        (existing, INTERNAL)
//
// Old skills deleted: Form Classifier, Relic Image Pick, Relic Metadata Scribe.
// AgentSkillEquip rows are cascade-deleted automatically.

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const OBSOLETE_SKILL_NAMES = [
  "Form Classifier",
  "Relic Image Pick",
  "Relic Metadata Scribe",
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    throw new Error("Refusing to seed in production. Set ALLOW_PROD_SEED=1 to override.");
  }

  // 0. Drop obsolete skills. AgentSkillEquip cascade handles slot cleanup.
  for (const name of OBSOLETE_SKILL_NAMES) {
    const r = await prisma.skill.deleteMany({ where: { nameEn: name } });
    if (r.count > 0) console.log(`✗ deleted obsolete skill: ${name} (${r.count})`);
  }

  // 1. Files Summary — unchanged from previous iteration.
  const filesSummary = await upsertSkillByName({
    nameEn: "Relic Files Summary",
    nameZh: "遗物文件聚合",
    icon: "folder_zip",
    level: 1,
    kind: "PASSIVE",
    descriptionEn:
      "Reads the relic's extracted/ files + draftNote and produces a flat text summary plus image paths for downstream vision skills.",
    descriptionZh:
      "读取遗物 extracted/ 目录文件 + 用户描述,产出文本摘要 + 图片路径供下游视觉技能消费。",
    handlerKind: "INTERNAL",
    handlerConfig: {
      handler: "relic-files-summary",
      maxFiles: 50,
      maxTextBytes: 8192,
      allowDryRun: true,
    },
    inputSchema: null,
    outputSchema: {
      type: "object",
      properties: {
        userBrief: { type: "string" },
        relicSlug: { type: "string" },
        fileSummary: { type: "string" },
        fileCount: { type: "number" },
        imageCount: { type: "number" },
        otherCount: { type: "number" },
        imageAbsPaths: { type: "array", items: { type: "string" } },
      },
      required: ["userBrief", "fileSummary"],
    },
  });
  console.log("✓ skill:", filesSummary.nameEn, filesSummary.id);

  // 2. Gemini Researcher — Google Search Grounding, two-pass (lore + metadata).
  // Used both as the initial research/metadata producer AND for the
  // "重新生成名号/副标/图标" admin action (regen mode).
  const researcher = await upsertSkillByName({
    nameEn: "Relic Gemini Researcher",
    nameZh: "遗物调研者",
    icon: "auto_stories",
    level: 3,
    kind: "ULTIMATE",
    descriptionEn:
      "Gemini-powered, web-grounded researcher. Two-pass: writes the relic's lore from Google Search results, then derives title/subtitle/icon/rarity/formKind + image-pick decision. Supports regen mode (skips lore pass when input.existingLore present).",
    descriptionZh:
      "基于 Gemini 的联网调研者。两阶段:先用 Google 搜索结果写圣记 lore,再从 lore 派生名号/副标/图标/品阶/形态 + 挑图决策。支持 regen 模式(input.existingLore 存在时跳过 lore 生成)。",
    handlerKind: "INTERNAL",
    handlerConfig: {
      handler: "relic-gemini-researcher",
      model: "gemini-2.5-flash",
      authEnv: "GEMINI_API_KEY",
      grounding: true,
    },
    inputSchema: null,
    // No output schema — the handler already enforces shape via fallbacks
    // (returns "无名遗物" if title missing, etc.). Strict schema validation
    // here would reject perfectly usable outputs whenever Gemini omits one
    // optional field. The pipeline step's `degraded` flag is the real
    // success guard.
    outputSchema: null,
  });
  console.log("✓ skill:", researcher.nameEn, researcher.id);

  // 3. Smart Image Picker — candidate set with optional SerpAPI net images.
  const picker = await upsertSkillByName({
    nameEn: "Relic Smart Image Picker",
    nameZh: "智能图集筛选",
    icon: "collections",
    level: 2,
    kind: "ACTIVE",
    descriptionEn:
      "Builds the candidate image set: every user upload + (when researcher decided 'mass-produced') up to 3 high-resolution images via SerpAPI. Recommends a primary; admin can change in the review UI.",
    descriptionZh:
      "构建候选图集:全部用户图 + (调研者判定为量产物品时)最多 3 张 SerpAPI 高清图。推荐一张作主图,admin 可在 review 界面改。",
    handlerKind: "INTERNAL",
    handlerConfig: {
      handler: "relic-smart-image-pick",
      searchAuthEnv: "SERPAPI_KEY",
      maxNetworkFetch: 3,
    },
    inputSchema: null,
    outputSchema: {
      type: "object",
      properties: {
        candidates: { type: "array" },
        recommendedPrimaryPath: { type: "string" },
        networkFetchAttempted: { type: "boolean" },
        networkFetchFailureReason: { type: "string" },
      },
      required: ["candidates", "recommendedPrimaryPath"],
    },
  });
  console.log("✓ skill:", picker.nameEn, picker.id);

  // 4. Background Cutout — fal.ai BiRefNet, used only by 2dEnhance branch.
  const cutout = await upsertSkillByName({
    nameEn: "Relic Background Cutout",
    nameZh: "背景抠图",
    icon: "wallpaper",
    level: 2,
    kind: "ACTIVE",
    descriptionEn:
      "Removes the background from the relic's primary image via fal.ai BiRefNet. Outputs a transparent PNG used as the 2D enhanced asset and as input to the 3D pipeline.",
    descriptionZh:
      "用 fal.ai BiRefNet 抠掉主图背景。输出透明 PNG,作为 2D 增强成品 + 3D 创建路径的输入。",
    handlerKind: "INTERNAL",
    handlerConfig: {
      handler: "relic-cutout",
      authEnv: "FAL_API_KEY",
      model: "fal-ai/birefnet/v2",
    },
    inputSchema: null,
    outputSchema: {
      type: "object",
      properties: {
        enhancedImagePath: { type: "string" },
        sourceImagePath: { type: "string" },
        elapsedMs: { type: "number" },
      },
      required: ["enhancedImagePath"],
    },
  });
  console.log("✓ skill:", cutout.nameEn, cutout.id);

  // 5. Meshy 3D — unchanged, but input field renamed from primaryImagePath
  // to imagePath to be source-agnostic. Update handlerConfig comment only;
  // the meshy3d.ts handler reads input.primaryImagePath today — TODO: also
  // accept input.imagePath. For now seed maps imagePath via merge in DAG.
  const meshy = await upsertSkillByName({
    nameEn: "Meshy 3D Generator",
    nameZh: "Meshy 立体化",
    icon: "deployed_code",
    level: 3,
    kind: "ULTIMATE",
    descriptionEn:
      "Submits the (transparent) primary image to Meshy's image-to-3D API, polls until the GLB is ready, and downloads it into the relic's derived/.",
    descriptionZh:
      "把(透明)主图提交给 Meshy 的 image-to-3D API,轮询至 GLB 就绪后下载到遗物 derived/ 目录。",
    handlerKind: "INTERNAL",
    handlerConfig: {
      handler: "meshy-3d",
      authEnv: "MESHY_API_KEY",
      mode: "preview",
      pollIntervalMs: 10000,
      pollTimeoutMs: 300000,
    },
    inputSchema: null,
    outputSchema: {
      type: "object",
      properties: {
        modelPath: { type: "string" },
        taskId: { type: "string" },
        previewImageUrl: { type: "string" },
        elapsedMs: { type: "number" },
      },
      required: ["modelPath", "taskId"],
    },
  });
  console.log("✓ skill:", meshy.nameEn, meshy.id);

  console.log("\nNext: npx tsx prisma/seed-relic-scribe-agent.ts");
}

type UpsertArgs = {
  nameEn: string;
  nameZh: string;
  icon: string;
  level: number;
  kind: "PASSIVE" | "ACTIVE" | "ULTIMATE";
  descriptionEn: string;
  descriptionZh: string;
  handlerKind: "HTTP_API" | "LLM_PROMPT" | "MCP_SERVER" | "INTERNAL";
  handlerConfig: Record<string, unknown>;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
};

async function upsertSkillByName(args: UpsertArgs) {
  const existing = await prisma.skill.findFirst({ where: { nameEn: args.nameEn } });
  const data = {
    nameEn: args.nameEn,
    nameZh: args.nameZh,
    icon: args.icon,
    level: args.level,
    kind: args.kind,
    descriptionEn: args.descriptionEn,
    descriptionZh: args.descriptionZh,
    handlerKind: args.handlerKind,
    handlerConfig: args.handlerConfig as Prisma.InputJsonValue,
    inputSchema:
      args.inputSchema === null
        ? Prisma.JsonNull
        : (args.inputSchema as Prisma.InputJsonValue),
    outputSchema:
      args.outputSchema === null
        ? Prisma.JsonNull
        : (args.outputSchema as Prisma.InputJsonValue),
  };
  if (existing) return prisma.skill.update({ where: { id: existing.id }, data });
  return prisma.skill.create({ data });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
