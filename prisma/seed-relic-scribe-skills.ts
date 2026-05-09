// One-off seed: creates the two Skills used by the RELIC-SCRIBE-001 agent.
// Idempotent — re-run safe (upserts by nameEn).
//
// Run: npx tsx prisma/seed-relic-scribe-skills.ts

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    throw new Error("Refusing to seed in production. Set ALLOW_PROD_SEED=1 to override.");
  }

  // Skill 1: INTERNAL — read extracted files + draftNote into a flat summary.
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

  // Skill 3: LLM_PROMPT (vision) — classify TWO_D vs THREE_D.
  const classifier = await upsertSkillByName({
    nameEn: "Form Classifier",
    nameZh: "形态判定者",
    icon: "category",
    level: 2,
    kind: "ACTIVE",
    descriptionEn:
      "Looks at the uploaded images + user brief and decides whether this relic is best shown as a flat 2D image (painting, photo, document) or a 3D model (sculpture, figurine, physical object).",
    descriptionZh:
      "查看上传的图片与用户描述,判定遗物是 2D 平面(画作、照片、文档)还是 3D 立体(雕塑、手办、实物)。",
    handlerKind: "LLM_PROMPT",
    handlerConfig: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      maxTokens: 512,
      responseFormat: "json",
      imagePathsField: "imageAbsPaths",
      systemPrompt: [
        "You decide whether a personal relic should be displayed as a flat 2D image or as a 3D rendered model.",
        "",
        "Output STRICT JSON only — no markdown fences. Shape:",
        '  {"kind": "TWO_D"|"THREE_D", "reason": string}',
        "",
        "Decision rules:",
        '- TWO_D: paintings, drawings, photos, scanned letters/documents, posters, anything inherently flat — even if photographed at an angle.',
        "- THREE_D: sculptures, figurines, ceramics, jewelry, tools, plush toys, anything whose value comes from its physical volume.",
        "- If ambiguous (flat object photographed at an angle), prefer TWO_D unless the user brief explicitly emphasizes the 3D form.",
        "- `reason`: ≤120 chars, plain language, addresses the specific item — written for the relic owner to read on the detail page. Match the user's language (Chinese if the brief is Chinese).",
      ].join("\n"),
      userTemplate: [
        "User brief:",
        "{{userBrief}}",
        "",
        "File summary:",
        "{{fileSummary}}",
      ].join("\n"),
    },
    inputSchema: null,
    outputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["TWO_D", "THREE_D"] },
        reason: { type: "string" },
      },
      required: ["kind", "reason"],
    },
  });
  console.log("✓ skill:", classifier.nameEn, classifier.id);

  // Skill 4: INTERNAL — pick the largest image as the 2D primary.
  const imagePick = await upsertSkillByName({
    nameEn: "Relic Image Pick",
    nameZh: "图像选取",
    icon: "photo_library",
    level: 1,
    kind: "PASSIVE",
    descriptionEn:
      "v1: copies the largest source image into derived/ as the 2D primary. Future iterations will add background removal + composition.",
    descriptionZh:
      "v1:从源文件中挑出最大的图片复制到 derived/ 作为 2D 主图。未来迭代会加上抠图与拼合。",
    handlerKind: "INTERNAL",
    handlerConfig: { handler: "relic-image-pick" },
    inputSchema: null,
    outputSchema: {
      type: "object",
      properties: {
        primaryImagePath: { type: "string" },
        sourcePath: { type: "string" },
        pickedFromCount: { type: "number" },
      },
      required: ["primaryImagePath"],
    },
  });
  console.log("✓ skill:", imagePick.nameEn, imagePick.id);

  // Skill 5: INTERNAL — Meshy image-to-3D end to end.
  const meshy = await upsertSkillByName({
    nameEn: "Meshy 3D Generator",
    nameZh: "Meshy 立体化",
    icon: "deployed_code",
    level: 3,
    kind: "ULTIMATE",
    descriptionEn:
      "Submits the 2D primary image to Meshy's image-to-3D API, polls until the GLB is ready, and downloads it into the relic's derived/.",
    descriptionZh:
      "把 2D 主图提交给 Meshy 的 image-to-3D API,轮询至 GLB 就绪后下载到遗物 derived/ 目录。",
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

  // Skill 2: LLM_PROMPT — turn the summary into icon/title/subtitle/rarity JSON.
  const metadata = await upsertSkillByName({
    nameEn: "Relic Metadata Scribe",
    nameZh: "遗物元数据执笔",
    icon: "auto_awesome",
    level: 2,
    kind: "ACTIVE",
    descriptionEn:
      "Given a relic's user brief and file summary, produces strict JSON {titleZh,titleEn,subtitleZh,subtitleEn,icon,rarity} matching the RELIC-SCRIBE-001 contract.",
    descriptionZh:
      "依据用户描述与文件摘要,产出严格 JSON {titleZh,titleEn,subtitleZh,subtitleEn,icon,rarity},匹配 RELIC-SCRIBE-001 约定。",
    handlerKind: "LLM_PROMPT",
    handlerConfig: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      maxTokens: 1024,
      responseFormat: "json",
      // Metadata is the DAG's leaf node; its inputFrom is a merge so the
      // input is shaped { files, classify, twoD, threeD }. Template paths
      // and imagePathsField use dot-paths to drill into that shape.
      imagePathsField: "files.imageAbsPaths",
      systemPrompt: [
        "You are the Relic Scribe. You assign titles, subtitles, an icon, and a rarity to a personal relic uploaded by a user. You see the photos directly.",
        "",
        "Output STRICT JSON only — no markdown, no commentary. Shape:",
        '  {"titleZh": string, "titleEn": string, "subtitleZh": string, "subtitleEn": string, "icon": string, "rarity": "COMMON"|"RARE"|"EPIC"|"LEGENDARY"|"SPECIAL"}',
        "",
        "Rules:",
        "- titleZh/titleEn: ONE line each. titleZh ≤ 12 Chinese chars; titleEn ≤ 24 chars. Concise, evocative, NOT generic.",
        "- subtitleZh/subtitleEn: ONE line classifier (e.g. '档案 · 家书' / 'Archive · Family Letter'). subtitleZh ≤ 16 chars; subtitleEn ≤ 32.",
        "- icon: a Material Symbols (Outlined) name. e.g. 'menu_book', 'photo_album', 'mail', 'inventory_2'. Must be a real symbol.",
        "- rarity: judge from emotional weight + uniqueness. Default COMMON; reserve LEGENDARY/SPECIAL for clearly extraordinary items.",
        "- If the user brief or files are too thin, still output a best-effort guess — do NOT refuse with placeholder names like 'Unnamed Relic' / '无名遗物'.",
      ].join("\n"),
      userTemplate: [
        "User brief:",
        "{{files.userBrief}}",
        "",
        "File summary:",
        "{{files.fileSummary}}",
        "",
        "Form classifier said: {{classify.kind}} — {{classify.reason}}",
      ].join("\n"),
    },
    inputSchema: null,
    outputSchema: {
      type: "object",
      properties: {
        titleZh: { type: "string" },
        titleEn: { type: "string" },
        subtitleZh: { type: "string" },
        subtitleEn: { type: "string" },
        icon: { type: "string" },
        rarity: {
          type: "string",
          enum: ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"],
        },
      },
      required: ["titleZh", "titleEn", "subtitleZh", "subtitleEn", "icon", "rarity"],
    },
  });
  console.log("✓ skill:", metadata.nameEn, metadata.id);

  console.log("\nNext steps:");
  console.log(
    "  1. /agent-control?tab=skills — confirm both skills are listed (status ONLINE).",
  );
  console.log(
    "  2. /agent-control?tab=agents — create agent with codename RELIC-SCRIBE-001 (mode=MECHANICAL).",
  );
  console.log("  3. Equip 'Relic Files Summary' to slot 0, 'Relic Metadata Scribe' to slot 1.");
  console.log("  4. Set Backbone config (see CLAUDE conversation), then Deploy.");
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
  if (existing) {
    return prisma.skill.update({ where: { id: existing.id }, data });
  }
  return prisma.skill.create({ data });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
