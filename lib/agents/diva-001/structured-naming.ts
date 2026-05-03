import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentCapability } from "../types";
import { withInvocationLogging } from "../types";
import { getSecretOrEnv } from "@/lib/agentSecrets";

const SYSTEM_PROMPT = `You are the Cataloguer of the Green Diva Sanctuary's relic vault. Given a brief description and one or more photos of a personal item, you propose vault catalogue entries based on the combined visual + textual evidence.

You MUST reply with a single JSON object — no prose, no markdown fences — matching this shape:

{
  "nameEn": "concise English name, 2-5 words, Title Case, evocative",
  "nameZh": "简洁中文名，2-6 字，意境化",
  "classifEn": "ALL-CAPS sub-classification in the style of a museum tag, e.g. \\"BLOODBORNE · HOLY CHALICE\\" or \\"FATAL FRAME · SEALED CAMERA\\". Optionally reference a video game / film / book / mythology that matches the item's mood.",
  "classifZh": "对应中文副标题，全角中点 · 分隔，例：\\"血源诅咒 · 圣杯\\"",
  "rarity": "one of: COMMON | RARE | EPIC | LEGENDARY",
  "iconKey": "single Material Symbols Outlined identifier most evocative of the item, e.g. \\"diamond\\", \\"key\\", \\"book_4_spark\\". Snake_case lowercase.",
  "loreEn": "1-3 sentences of mood-text, mythic/poetic register, may cite concrete details visible in the photos",
  "loreZh": "1-3 句对应中文，意境化，可引用照片中可观察的细节"
}

Do NOT propose SPECIAL rarity (passwords are decided by the curator separately). Pick rarity based on apparent significance: everyday → COMMON, notable → RARE, treasured → EPIC, life-defining → LEGENDARY. When uncertain, default to COMMON. When multiple photos are provided, treat them as different views of the same item.`;

export type StructuredNamingMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export type StructuredNamingImage = {
  mediaType: StructuredNamingMediaType;
  base64: string;
};

export type StructuredNamingInput = {
  description: string;
  images: StructuredNamingImage[];
};

export type StructuredNamingOutput = {
  nameEn: string;
  nameZh: string;
  classifEn: string;
  classifZh: string;
  rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
  iconKey: string;
  loreEn: string;
  loreZh: string;
};

async function getClient(): Promise<Anthropic> {
  const key = await getSecretOrEnv("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey: key });
}

const baseCapability: AgentCapability<StructuredNamingInput, StructuredNamingOutput> = {
  id: "structured-naming",
  agentCodename: "DIVA-001",
  metadata: {
    iconKey: "psychology",
    nameEn: "Cataloguer",
    nameZh: "归档官",
    descriptionEn: "Reads photos and a one-line description, then proposes name / classification / rarity / icon as a single JSON record.",
    descriptionZh: "读图与描述，给出中英名号、副标、品阶、图标，结构化为一条 JSON。",
    provider: "anthropic",
    requiredEnvVars: ["ANTHROPIC_API_KEY"],
  },
  serializeInput(input) {
    return {
      description: input.description,
      imageCount: input.images.length,
    };
  },
  async run(agent, input) {
    const c = await getClient();

    type Block =
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: StructuredNamingMediaType; data: string };
        };
    const userBlocks: Block[] = [];
    for (const img of input.images) {
      userBlocks.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      });
    }
    userBlocks.push({
      type: "text",
      text: input.description.trim() || "(no description provided — infer from the photos)",
    });

    const overlay = (agent.systemPrompt ?? "").trim();
    const systemText = overlay
      ? `${SYSTEM_PROMPT}\n\n--- Style overlay (do not break the JSON contract above) ---\n${overlay}`
      : SYSTEM_PROMPT;

    const resp = await c.messages.create({
      model: agent.model ?? "claude-haiku-4-5-20251001",
      max_tokens: agent.maxTokens ?? 800,
      temperature: agent.temperature ?? 0.7,
      system: [
        {
          type: "text",
          text: systemText,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
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
    const rarity = (RARITY as readonly string[]).includes(parsed.rarity)
      ? (parsed.rarity as StructuredNamingOutput["rarity"])
      : "COMMON";
    const out: StructuredNamingOutput = {
      nameEn: String(parsed.nameEn ?? "").slice(0, 120),
      nameZh: String(parsed.nameZh ?? "").slice(0, 120),
      classifEn: String(parsed.classifEn ?? "").slice(0, 160),
      classifZh: String(parsed.classifZh ?? "").slice(0, 160),
      rarity,
      iconKey: String(parsed.iconKey ?? "inventory_2").slice(0, 64),
      loreEn: String(parsed.loreEn ?? "").slice(0, 1000),
      loreZh: String(parsed.loreZh ?? "").slice(0, 1000),
    };
    if (!out.nameEn || !out.nameZh) throw new Error("AI returned empty name");
    return out;
  },
};

export const structuredNamingCapability = withInvocationLogging(baseCapability);

export function parseImageDataUrl(dataUrl: string): StructuredNamingImage | null {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) return null;
  return { mediaType: m[1] as StructuredNamingMediaType, base64: m[2] };
}
