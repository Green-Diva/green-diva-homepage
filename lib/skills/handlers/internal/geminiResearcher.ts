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
// handlerConfig (everything optional — falls back to bundled defaults):
//   {
//     model?: string,                 // default "gemini-2.5-flash"
//     authEnv?: string,               // default "GEMINI_API_KEY"
//     grounding?: boolean,            // default true (only honored on pass 1)
//     maxOutputTokensLore?: number,   // default 4096
//     maxOutputTokensMetadata?: number, // default 8192
//     maxImages?: number,             // Phase 2.4.4: vision input cap, default 6
//     maxImageBytes?: number,         // Phase 2.4.4: per-image byte cap, default 5MB
//     prompts?: {
//       loreEn?: string,              // overrides DEFAULT_LORE_EN_PROMPT
//       loreZh?: string,              // overrides DEFAULT_LORE_ZH_PROMPT
//       metadata?: string,            // overrides DEFAULT_METADATA_PROMPT
//     },
//     outputCaps?: {                  // per-field slice() ceilings on the
//       titleZh?, titleEn?,           // metadata pass output. Overshooting
//       subtitleZh?, subtitleEn?,     // would break truncate in the relic
//       icon?, decisionReason?,       // grid cell — these caps are the
//       networkImageQuery?,           // safety net for prompt drift.
//     },
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
//
// Why prompts live in handlerConfig: changing a prompt to retune model
// behavior is the most frequent ask (vs rewriting the orchestration). Keeping
// them in DB-side handlerConfig means admin edits the prompt in
// /agent-control SkillLibrary's handlerConfig editor and the next call uses
// it — no commit, no deploy. Source-tree DEFAULT_* constants below remain
// the canonical baseline (and the "reset to default" payload for future UI).

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { HandlerError, type SkillHandler } from "../../types";
// Phase 5 R2: prompts hoisted out so migrate scripts (which can't import
// `server-only` modules) can seed LORE-FORGE-001's LLM_PROMPT skills
// from the same canonical strings.
import {
  DEFAULT_LORE_EN_PROMPT as _DEFAULT_LORE_EN_PROMPT,
  DEFAULT_LORE_ZH_PROMPT as _DEFAULT_LORE_ZH_PROMPT,
  DEFAULT_METADATA_PROMPT as _DEFAULT_METADATA_PROMPT,
} from "../../relic-prompts";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_AUTH_ENV = "GEMINI_API_KEY";
// Gemini 2.5 thinking models burn extra tokens on internal reasoning
// before emitting the JSON. The metadata system prompt is long (~80 lines
// of constraints), which provokes deep thinking — observed runs hit
// finishReason=MAX_TOKENS at 2048 with the JSON cut off mid-field. 8192
// gives ~6× headroom so the model can reason AND finish the 9-field JSON.
const DEFAULT_LORE_TOKENS = 4096;
const DEFAULT_META_TOKENS = 8192;
// Phase 2.4.4: bumped to admin-tunable defaults; entry handler reads
// handlerConfig.maxImages / maxImageBytes and threads them in.
const DEFAULT_MAX_IMAGES = 6;
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// — — DEFAULT prompts — — — — — — — — — — — — — — — — — — — — — — — — —
//
// Re-exported from lib/skills/relic-prompts.ts (Phase 5 R2 hoist).
// Kept exported here for back-compat with anything importing the old
// path. Edit the source file, not these aliases.
export const DEFAULT_LORE_EN_PROMPT = _DEFAULT_LORE_EN_PROMPT;
export const DEFAULT_LORE_ZH_PROMPT = _DEFAULT_LORE_ZH_PROMPT;
export const DEFAULT_METADATA_PROMPT = _DEFAULT_METADATA_PROMPT;

// Per-field slice() ceilings on metadata pass output. Match the prompt's
// HARD CAPS (×~1.5 buffer for char-vs-byte edge cases and the model
// occasionally overshooting). Anything past these would break line-clamp-1
// in the relic grid cell anyway. Exposed as a constant so the safety net
// stays visible alongside the prompt that's supposed to enforce them.
export const DEFAULT_OUTPUT_CAPS = {
  titleZh: 12,
  titleEn: 14,
  subtitleZh: 10,
  subtitleEn: 18,
  icon: 64,
  decisionReason: 200,
  networkImageQuery: 200,
} as const;

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const RARITY_ENUM = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;
type FormKind = "TWO_D" | "THREE_D";
// Widen literal-typed DEFAULT_OUTPUT_CAPS to plain `number` per field so
// resolveCaps can return arbitrary admin-provided ints. Keys stay locked
// to the canonical set.
type OutputCaps = { [K in keyof typeof DEFAULT_OUTPUT_CAPS]: number };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stripCodeFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : t;
}

// Resolve admin-provided prompts from handlerConfig.prompts, falling back
// to the bundled DEFAULT_*_PROMPT constants for absent / non-string values.
// Empty strings are treated as absence too (admin clears textarea = use
// default, not "blank prompt").
function resolvePrompts(config: Record<string, unknown>): {
  loreEn: string;
  loreZh: string;
  metadata: string;
} {
  const p = isObject(config.prompts) ? config.prompts : {};
  const pick = (raw: unknown, fallback: string): string =>
    typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;
  return {
    loreEn: pick(p.loreEn, DEFAULT_LORE_EN_PROMPT),
    loreZh: pick(p.loreZh, DEFAULT_LORE_ZH_PROMPT),
    metadata: pick(p.metadata, DEFAULT_METADATA_PROMPT),
  };
}

function resolveCaps(config: Record<string, unknown>): OutputCaps {
  const c = isObject(config.outputCaps) ? config.outputCaps : {};
  const pick = (raw: unknown, fallback: number): number =>
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  return {
    titleZh: pick(c.titleZh, DEFAULT_OUTPUT_CAPS.titleZh),
    titleEn: pick(c.titleEn, DEFAULT_OUTPUT_CAPS.titleEn),
    subtitleZh: pick(c.subtitleZh, DEFAULT_OUTPUT_CAPS.subtitleZh),
    subtitleEn: pick(c.subtitleEn, DEFAULT_OUTPUT_CAPS.subtitleEn),
    icon: pick(c.icon, DEFAULT_OUTPUT_CAPS.icon),
    decisionReason: pick(c.decisionReason, DEFAULT_OUTPUT_CAPS.decisionReason),
    networkImageQuery: pick(c.networkImageQuery, DEFAULT_OUTPUT_CAPS.networkImageQuery),
  };
}

async function loadImageParts(
  paths: string[],
  opts: { maxImages: number; maxImageBytes: number },
): Promise<Part[]> {
  const out: Part[] = [];
  for (const p of paths.slice(0, opts.maxImages)) {
    const ext = path.extname(p).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) continue;
    try {
      const stat = await fs.stat(p);
      if (stat.size > opts.maxImageBytes) continue;
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
  enPrompt: string;
  zhPrompt: string;
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
    systemInstruction: opts.enPrompt,
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
  const zhResult = await zhModel.generateContent({
    contents: [{ role: "user", parts: [{ text: loreEn }] }],
    systemInstruction: opts.zhPrompt,
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
  metadataPrompt: string;
  caps: OutputCaps;
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
    systemInstruction: opts.metadataPrompt,
  });
  const text = result.response.text();
  const cleaned = stripCodeFence(text);
  // finishReason=MAX_TOKENS means the model truncated mid-output (typically
  // because thinking tokens consumed the budget). Surface that explicitly so
  // the UI shows "raise maxOutputTokens" instead of a generic parse failure.
  const finishReason =
    (result.response.candidates?.[0] as { finishReason?: string } | undefined)?.finishReason ??
    "UNKNOWN";
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const hint =
      finishReason === "MAX_TOKENS"
        ? ` (finishReason=MAX_TOKENS — output truncated; raise maxOutputTokensMetadata, current=${opts.maxTokens})`
        : ` (finishReason=${finishReason})`;
    throw new HandlerError(
      `relic-gemini-researcher: metadata pass returned non-JSON${hint}: ${cleaned.slice(0, 300)}`,
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
    titleZh: String(parsed.titleZh ?? "").trim().slice(0, opts.caps.titleZh) || "无名",
    titleEn: String(parsed.titleEn ?? "").trim().slice(0, opts.caps.titleEn) || "Unnamed",
    subtitleZh: String(parsed.subtitleZh ?? "").trim().slice(0, opts.caps.subtitleZh) || "档案 · 待考",
    subtitleEn: String(parsed.subtitleEn ?? "").trim().slice(0, opts.caps.subtitleEn) || "Reliq · Lost",
    icon: String(parsed.icon ?? "inventory_2").trim().slice(0, opts.caps.icon),
    rarity: (RARITY_ENUM as readonly string[]).includes(rarityRaw)
      ? (rarityRaw as (typeof RARITY_ENUM)[number])
      : "COMMON",
    formKind,
    useUserImage,
    networkImageQuery:
      typeof parsed.networkImageQuery === "string" && parsed.networkImageQuery.trim()
        ? parsed.networkImageQuery.trim().slice(0, opts.caps.networkImageQuery)
        : undefined,
    decisionReason: String(parsed.decisionReason ?? "").trim().slice(0, opts.caps.decisionReason),
  };
}

export const geminiResearcher: SkillHandler = async (input, config) => {
  const model = typeof config.model === "string" ? config.model : DEFAULT_MODEL;
  const envName = typeof config.authEnv === "string" && config.authEnv ? config.authEnv : DEFAULT_AUTH_ENV;
  const grounding = config.grounding !== false;
  const loreTokens = typeof config.maxOutputTokensLore === "number" ? config.maxOutputTokensLore : DEFAULT_LORE_TOKENS;
  const metaTokens = typeof config.maxOutputTokensMetadata === "number" ? config.maxOutputTokensMetadata : DEFAULT_META_TOKENS;
  const apiKey = process.env[envName];

  // Resolve overridable bits up-front so dry-run and real runs see the
  // same resolution path.
  const prompts = resolvePrompts(config);
  const caps = resolveCaps(config);

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
  const maxImages =
    typeof config.maxImages === "number" && config.maxImages > 0
      ? Math.floor(config.maxImages)
      : DEFAULT_MAX_IMAGES;
  const maxImageBytes =
    typeof config.maxImageBytes === "number" && config.maxImageBytes > 0
      ? Math.floor(config.maxImageBytes)
      : DEFAULT_MAX_IMAGE_BYTES;
  const imageParts = await loadImageParts(imageAbsPaths, { maxImages, maxImageBytes });

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
      metadataPrompt: prompts.metadata,
      caps,
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
    enPrompt: prompts.loreEn,
    zhPrompt: prompts.loreZh,
    userBrief,
    fileSummary,
    textExcerpts,
    imageParts,
  });
  const meta = await runMetadataPass({
    apiKey,
    model,
    maxTokens: metaTokens,
    metadataPrompt: prompts.metadata,
    caps,
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
