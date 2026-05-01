import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Server-only: ANTHROPIC_API_KEY MUST never reach the client. This module is
// `import "server-only"`, all callers are server route handlers gated by
// requireAdmin(), and rate-limited per IP. The key is read lazily so importing
// this module from a misplaced client component will only fail when called.

const NAMING_SYSTEM_PROMPT = `You are the Cataloguer of the Green Diva Sanctuary's relic vault. Given a brief description (and optionally a photo) of a personal item, you propose vault catalogue entries.

You MUST reply with a single JSON object — no prose, no markdown fences — matching this shape:

{
  "nameEn": "concise English name, 2-5 words, Title Case, evocative",
  "nameZh": "简洁中文名，2-6 字，意境化",
  "classifEn": "ALL-CAPS sub-classification in the style of a museum tag, e.g. \\"BLOODBORNE · HOLY CHALICE\\" or \\"FATAL FRAME · SEALED CAMERA\\". Optionally reference a video game / film / book / mythology that matches the item's mood.",
  "classifZh": "对应中文副标题，全角中点 · 分隔，例：\\"血源诅咒 · 圣杯\\"",
  "rarity": "one of: COMMON | RARE | EPIC | LEGENDARY",
  "iconKey": "single Material Symbols Outlined identifier most evocative of the item, e.g. \\"diamond\\", \\"key\\", \\"book_4_spark\\". Snake_case lowercase.",
  "loreEn": "1-3 sentences of mood-text, mythic/poetic register",
  "loreZh": "1-3 句对应中文，意境化"
}

Do NOT propose SPECIAL rarity (passwords are decided by the curator separately). Pick rarity based on apparent significance: everyday → COMMON, notable → RARE, treasured → EPIC, life-defining → LEGENDARY. When uncertain, default to COMMON.`;

export type AiNamingInput = {
  description: string;
  imageDataUrl?: string | null; // optional data URL "data:image/jpeg;base64,..."
};

export type AiNamingOutput = {
  nameEn: string;
  nameZh: string;
  classifEn: string;
  classifZh: string;
  rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
  iconKey: string;
  loreEn: string;
  loreZh: string;
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  client = new Anthropic({ apiKey: key });
  return client;
}

function parseImageDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

export async function suggestRelicNaming(input: AiNamingInput): Promise<AiNamingOutput> {
  const c = getClient();

  type Block =
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      };
  const userBlocks: Block[] = [];

  if (input.imageDataUrl) {
    const parsed = parseImageDataUrl(input.imageDataUrl);
    if (parsed) {
      userBlocks.push({
        type: "image",
        source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
      });
    }
  }
  userBlocks.push({
    type: "text",
    text: input.description.trim() || "(no description provided — infer from the photo)",
  });

  const resp = await c.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    system: [
      {
        type: "text",
        text: NAMING_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        // SDK accepts the structured content blocks
        content: userBlocks as unknown as Anthropic.MessageParam["content"],
      },
    ],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI did not return JSON");
  const parsed = JSON.parse(jsonMatch[0]);

  const RARITY = ["COMMON", "RARE", "EPIC", "LEGENDARY"] as const;
  const out: AiNamingOutput = {
    nameEn: String(parsed.nameEn ?? "").slice(0, 120),
    nameZh: String(parsed.nameZh ?? "").slice(0, 120),
    classifEn: String(parsed.classifEn ?? "").slice(0, 160),
    classifZh: String(parsed.classifZh ?? "").slice(0, 160),
    rarity: (RARITY as readonly string[]).includes(parsed.rarity) ? parsed.rarity : "COMMON",
    iconKey: String(parsed.iconKey ?? "inventory_2").slice(0, 64),
    loreEn: String(parsed.loreEn ?? "").slice(0, 1000),
    loreZh: String(parsed.loreZh ?? "").slice(0, 1000),
  };
  if (!out.nameEn || !out.nameZh) throw new Error("AI returned empty name");
  return out;
}
