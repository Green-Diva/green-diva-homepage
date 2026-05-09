// INTERNAL handler: relic-gemini-researcher
//
// Two-pass Gemini call. Pass 1 uses Google Search Grounding to write a
// comprehensive lore (markdown, bilingual) anchored in real facts about
// the relic's background. Pass 2 (no grounding) reads the lore + image
// vision and derives metadata: title / subtitle / icon / rarity / formKind +
// the image-pick decision (user vs network).
//
// REGEN MODE: when input.existingLore is present, pass 1 is skipped; only
// pass 2 runs with the supplied lore. This serves the "🔄 重新生成" button
// in the review UI — admin keeps their lore but lets AI re-derive metadata.
//
// handlerConfig:
//   {
//     model?: string,             // default "gemini-2.0-flash-exp"
//     authEnv?: string,           // default "GEMINI_API_KEY"
//     grounding?: boolean,        // default true (only honored on pass 1)
//     maxOutputTokensLore?: number,    // default 2048
//     maxOutputTokensMetadata?: number,// default 1024
//   }
//
// Input shapes:
//   Initial:  { userBrief, fileSummary, imageAbsPaths, textExcerpts? }
//   Regen:    { existingLore: { en: string; zh: string }, feedback?: string,
//               imageAbsPaths?: string[] /* optional re-vision */ }
//
// Output:
//   { loreZh, loreEn, citations?, titleZh, titleEn, subtitleZh, subtitleEn,
//     icon, rarity, formKind, useUserImage, networkImageQuery?, decisionReason }

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { HandlerError, type SkillHandler } from "../../types";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_AUTH_ENV = "GEMINI_API_KEY";
// Gemini 2.5 thinking models burn extra tokens on internal reasoning before
// emitting the JSON, so headroom matters. Lore pass gets the most because
// the model reasons through grounded facts; metadata pass needs less but
// still enough to write all 8 fields.
const DEFAULT_LORE_TOKENS = 4096;
const DEFAULT_META_TOKENS = 2048;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const RARITY_ENUM = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;
type FormKind = "TWO_D" | "THREE_D";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stripCodeFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : t;
}

async function loadImageParts(paths: string[]): Promise<Part[]> {
  const out: Part[] = [];
  for (const p of paths.slice(0, MAX_IMAGES)) {
    const ext = path.extname(p).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) continue;
    try {
      const stat = await fs.stat(p);
      if (stat.size > MAX_IMAGE_BYTES) continue;
      const buf = await fs.readFile(p);
      out.push({ inlineData: { mimeType: mime, data: buf.toString("base64") } });
    } catch {
      // Missing/unreadable — skip silently
    }
  }
  return out;
}

type Citation = { title: string; url: string };

type LoreOutput = {
  loreZh: string;
  loreEn: string;
  citations: Citation[];
};

type MetadataOutput = {
  titleZh: string;
  titleEn: string;
  subtitleZh: string;
  subtitleEn: string;
  icon: string;
  rarity: (typeof RARITY_ENUM)[number];
  formKind: FormKind;
  useUserImage: boolean;
  networkImageQuery?: string;
  decisionReason: string;
};

// Lore pass: when grounding is on, Gemini's JSON-mode is unavailable
// (`responseMimeType: "application/json"` conflicts with `tools`). So we
// run TWO sequential plain-text calls — one for English (with grounding,
// the heavy research happens here), one for Chinese (no grounding,
// translation only). Cheaper than asking for both languages in one call
// and trying to parse JSON, more reliable when grounding wants prose.
async function runLorePass(opts: {
  apiKey: string;
  model: string;
  grounding: boolean;
  maxTokens: number;
  userBrief: string;
  fileSummary: string;
  textExcerpts?: string;
  imageParts: Part[];
}): Promise<LoreOutput> {
  const genAI = new GoogleGenerativeAI(opts.apiKey);

  // — English (with optional grounding) —
  const enModel = genAI.getGenerativeModel({
    model: opts.model,
    ...(opts.grounding
      ? { tools: [{ googleSearch: {} } as unknown as never] }
      : {}),
    generationConfig: { maxOutputTokens: opts.maxTokens },
  });
  const enSys = [
    "You are the Relic Scribe — a curatorial researcher writing the canonical 'lore' for a personal relic uploaded to a private collection.",
    "Use the Google Search tool when needed to verify facts about specific objects (Lego sets, books, products, art pieces, historical artifacts). Cite implicitly via grounding; do NOT include URL lists in your output.",
    "",
    "Output: 1-3 paragraphs of English markdown prose. NO JSON wrapping, no preamble, no closing notes — just the lore itself. 150-300 words. Tone: literary, slightly archaic but accessible.",
    "",
    "Structure each lore to: (a) open with what the object is — researched, not inferred from photo alone; (b) place it in context — origin/era/maker/related works/cultural significance; (c) weave in the user's personal angle. Stay grounded — no fabrication.",
  ].join("\n");
  const enUserText = [
    "User brief:",
    opts.userBrief || "(none)",
    "",
    "File summary:",
    opts.fileSummary,
    ...(opts.textExcerpts ? ["", "Text excerpts:", opts.textExcerpts] : []),
  ].join("\n");
  const enResult = await enModel.generateContent({
    contents: [{ role: "user", parts: [...opts.imageParts, { text: enUserText }] }],
    systemInstruction: enSys,
  });
  const loreEn = enResult.response.text().trim();
  if (!loreEn) {
    throw new HandlerError(
      "relic-gemini-researcher: lore pass (en) returned empty text",
      "OUTPUT_PARSE",
    );
  }

  // — Chinese (translation only, no grounding, no images) —
  const zhModel = genAI.getGenerativeModel({
    model: opts.model,
    generationConfig: { maxOutputTokens: opts.maxTokens },
  });
  const zhSys = [
    "你是遗物执笔者。把以下英文圣记忠实译为中文,保持文学性与古雅气息。",
    "输出仅为中文 markdown 段落正文,200-400 字,不要 JSON 包装,不要前后注释,不要 \"中文翻译:\" 之类的开场白。",
  ].join("\n");
  const zhResult = await zhModel.generateContent({
    contents: [{ role: "user", parts: [{ text: loreEn }] }],
    systemInstruction: zhSys,
  });
  const loreZh = zhResult.response.text().trim();
  if (!loreZh) {
    throw new HandlerError(
      "relic-gemini-researcher: lore pass (zh translation) returned empty",
      "OUTPUT_PARSE",
    );
  }

  // Pull citations from the grounding metadata of the EN call.
  const groundingChunks =
    (enResult.response.candidates?.[0] as unknown as {
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    })?.groundingMetadata?.groundingChunks ?? [];
  const citations: Citation[] = groundingChunks
    .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
    .filter((c) => c.url);

  return { loreZh, loreEn, citations };
}

async function runMetadataPass(opts: {
  apiKey: string;
  model: string;
  maxTokens: number;
  loreZh: string;
  loreEn: string;
  imageParts: Part[];
  feedback?: string;
  hasUserImages: boolean;
}): Promise<MetadataOutput> {
  const genAI = new GoogleGenerativeAI(opts.apiKey);
  const model = genAI.getGenerativeModel({
    model: opts.model,
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: opts.maxTokens },
  });

  const sys = [
    "You are deriving structured metadata for a personal relic from its lore + photos.",
    "",
    "Output STRICT JSON in this exact shape:",
    '  {',
    '    "titleZh": string, "titleEn": string,',
    '    "subtitleZh": string, "subtitleEn": string,',
    '    "icon": string,',
    '    "rarity": "COMMON"|"RARE"|"EPIC"|"LEGENDARY"|"SPECIAL",',
    '    "formKind": "TWO_D"|"THREE_D",',
    '    "useUserImage": boolean,',
    '    "networkImageQuery": string,',
    '    "decisionReason": string',
    '  }',
    "",
    "Rules:",
    "- titleZh ≤12 Chinese chars, titleEn ≤24 chars, ONE line each. Concise + evocative + specific to this object.",
    "- subtitleZh ≤16 chars, subtitleEn ≤32. Format like '档案 · 家书' / 'Archive · Family Letter'.",
    "- icon: a real Material Symbols (Outlined) name. Examples: menu_book, photo_album, mail, inventory_2, local_florist, palette.",
    "- rarity: judge from emotional weight + uniqueness. Default COMMON; reserve LEGENDARY/SPECIAL for clearly extraordinary items.",
    "- formKind: TWO_D for paintings/photos/letters/anything inherently flat; THREE_D for sculptures/figurines/physical objects.",
    "- useUserImage: TRUE if the relic is personal/handcrafted/unique (only the user has it). FALSE if it's mass-produced (Lego set, branded toy, common art print, published book) and an official product photo would look much cleaner than the user's snapshot.",
    "- networkImageQuery: when useUserImage=false, give a precise search query to find the official/clean product photo (e.g. 'Lego white peace lily 10329 official product photo'). Empty string when useUserImage=true.",
    "- decisionReason: ≤120 chars, one sentence in the same language as the user's brief, explaining the useUserImage choice.",
  ].join("\n");

  const userParts: Part[] = [];
  // Re-show images so the model can directly judge "is this user photo good enough"
  for (const p of opts.imageParts) userParts.push(p);
  userParts.push({
    text: [
      "Lore (Chinese):",
      opts.loreZh,
      "",
      "Lore (English):",
      opts.loreEn,
      ...(opts.feedback ? ["", "Admin feedback for the regenerated metadata:", opts.feedback] : []),
      ...(!opts.hasUserImages ? ["", "Note: no user-uploaded images available; you must produce useUserImage=false."] : []),
    ].join("\n"),
  });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: userParts }],
    systemInstruction: sys,
  });
  const text = result.response.text();
  const cleaned = stripCodeFence(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new HandlerError(
      `relic-gemini-researcher: metadata pass returned non-JSON: ${cleaned.slice(0, 300)}`,
      "OUTPUT_PARSE",
    );
  }
  if (!isObject(parsed)) {
    throw new HandlerError(
      "relic-gemini-researcher: metadata pass JSON is not an object",
      "OUTPUT_PARSE",
    );
  }
  const rarityRaw = typeof parsed.rarity === "string" ? parsed.rarity.toUpperCase() : "COMMON";
  const formKindRaw = typeof parsed.formKind === "string" ? parsed.formKind.toUpperCase().replace(/[-_\s]/g, "") : "";
  const formKind: FormKind =
    formKindRaw === "THREED" || formKindRaw === "THREE_D" || formKindRaw === "3D" ? "THREE_D" : "TWO_D";
  const useUserImage = parsed.useUserImage !== false;

  return {
    titleZh: String(parsed.titleZh ?? "").trim().slice(0, 48) || "无名遗物",
    titleEn: String(parsed.titleEn ?? "").trim().slice(0, 80) || "Unnamed Relic",
    subtitleZh: String(parsed.subtitleZh ?? "").trim().slice(0, 64) || "档案 · 待考",
    subtitleEn: String(parsed.subtitleEn ?? "").trim().slice(0, 80) || "Archive · Unidentified",
    icon: String(parsed.icon ?? "inventory_2").trim().slice(0, 64),
    rarity: (RARITY_ENUM as readonly string[]).includes(rarityRaw)
      ? (rarityRaw as (typeof RARITY_ENUM)[number])
      : "COMMON",
    formKind,
    useUserImage,
    networkImageQuery:
      typeof parsed.networkImageQuery === "string" && parsed.networkImageQuery.trim()
        ? parsed.networkImageQuery.trim().slice(0, 200)
        : undefined,
    decisionReason: String(parsed.decisionReason ?? "").trim().slice(0, 200),
  };
}

export const geminiResearcher: SkillHandler = async (input, config) => {
  const model = typeof config.model === "string" ? config.model : DEFAULT_MODEL;
  const envName = typeof config.authEnv === "string" && config.authEnv ? config.authEnv : DEFAULT_AUTH_ENV;
  const grounding = config.grounding !== false;
  const loreTokens = typeof config.maxOutputTokensLore === "number" ? config.maxOutputTokensLore : DEFAULT_LORE_TOKENS;
  const metaTokens = typeof config.maxOutputTokensMetadata === "number" ? config.maxOutputTokensMetadata : DEFAULT_META_TOKENS;
  const apiKey = process.env[envName];

  if (!isObject(input)) {
    throw new HandlerError("relic-gemini-researcher: input must be an object", "INVALID_CONFIG");
  }
  if (input._dryRun === true) {
    return {
      loreZh: "[dry-run] 一件示例遗物的圣记。",
      loreEn: "[dry-run] Lore for a sample relic.",
      citations: [],
      titleZh: "示例遗物",
      titleEn: "Sample Relic",
      subtitleZh: "档案 · 示例",
      subtitleEn: "Archive · Sample",
      icon: "inventory_2",
      rarity: "COMMON" as const,
      formKind: "TWO_D" as const,
      useUserImage: true,
      decisionReason: "dry-run",
    };
  }
  if (!apiKey) {
    throw new HandlerError(`relic-gemini-researcher: env "${envName}" not set`, "MISSING_ENV");
  }

  const imageAbsPaths = Array.isArray(input.imageAbsPaths)
    ? (input.imageAbsPaths as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  const imageParts = await loadImageParts(imageAbsPaths);

  // — Regen mode: skip pass 1, reuse provided lore.
  if (isObject(input.existingLore)) {
    const loreZh = typeof input.existingLore.zh === "string" ? input.existingLore.zh : "";
    const loreEn = typeof input.existingLore.en === "string" ? input.existingLore.en : "";
    if (!loreZh || !loreEn) {
      throw new HandlerError(
        "relic-gemini-researcher: regen mode requires existingLore.{zh,en}",
        "INVALID_CONFIG",
      );
    }
    const meta = await runMetadataPass({
      apiKey,
      model,
      maxTokens: metaTokens,
      loreZh,
      loreEn,
      imageParts,
      feedback: typeof input.feedback === "string" ? input.feedback : undefined,
      hasUserImages: imageParts.length > 0,
    });
    // In regen we DON'T return new lore — caller keeps their version.
    return { ...meta, loreZh, loreEn, citations: [] };
  }

  // — Initial mode: pass 1 (lore w/ search) → pass 2 (metadata derivation).
  const userBrief = typeof input.userBrief === "string" ? input.userBrief : "";
  const fileSummary = typeof input.fileSummary === "string" ? input.fileSummary : "";
  const textExcerpts = typeof input.textExcerpts === "string" ? input.textExcerpts : undefined;

  const lore = await runLorePass({
    apiKey,
    model,
    grounding,
    maxTokens: loreTokens,
    userBrief,
    fileSummary,
    textExcerpts,
    imageParts,
  });
  const meta = await runMetadataPass({
    apiKey,
    model,
    maxTokens: metaTokens,
    loreZh: lore.loreZh,
    loreEn: lore.loreEn,
    imageParts,
    hasUserImages: imageParts.length > 0,
  });

  return {
    loreZh: lore.loreZh,
    loreEn: lore.loreEn,
    citations: lore.citations,
    ...meta,
  };
};
