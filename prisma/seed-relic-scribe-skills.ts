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
      "Reads the relic's extracted/ files + draftNote and produces a flat text summary suitable for downstream LLM consumption.",
    descriptionZh:
      "读取遗物 extracted/ 目录文件 + 用户描述,产出供下游 LLM 消费的扁平文本摘要。",
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
        fileSummary: { type: "string" },
        fileCount: { type: "number" },
        imageCount: { type: "number" },
        otherCount: { type: "number" },
      },
      required: ["userBrief", "fileSummary"],
    },
  });
  console.log("✓ skill:", filesSummary.nameEn, filesSummary.id);

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
      systemPrompt: [
        "You are the Relic Scribe. You assign titles, subtitles, an icon, and a rarity to a personal relic uploaded by a user.",
        "",
        "Output STRICT JSON only — no markdown, no commentary. Shape:",
        '  {"titleZh": string, "titleEn": string, "subtitleZh": string, "subtitleEn": string, "icon": string, "rarity": "COMMON"|"RARE"|"EPIC"|"LEGENDARY"|"SPECIAL"}',
        "",
        "Rules:",
        "- titleZh/titleEn: ONE line each. titleZh ≤ 12 Chinese chars; titleEn ≤ 24 chars. Concise, evocative, NOT generic.",
        "- subtitleZh/subtitleEn: ONE line classifier (e.g. '档案 · 家书' / 'Archive · Family Letter'). subtitleZh ≤ 16 chars; subtitleEn ≤ 32.",
        "- icon: a Material Symbols (Outlined) name. e.g. 'menu_book', 'photo_album', 'mail', 'inventory_2'. Must be a real symbol.",
        "- rarity: judge from emotional weight + uniqueness. Default COMMON; reserve LEGENDARY/SPECIAL for clearly extraordinary items.",
        "- If the user brief or files are too thin, still output a best-effort guess — do NOT refuse.",
      ].join("\n"),
      userTemplate: [
        "User brief:",
        "{{userBrief}}",
        "",
        "File summary:",
        "{{fileSummary}}",
      ].join("\n"),
    },
    inputSchema: {
      type: "object",
      properties: {
        userBrief: { type: "string" },
        fileSummary: { type: "string" },
      },
      required: ["userBrief", "fileSummary"],
    },
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
