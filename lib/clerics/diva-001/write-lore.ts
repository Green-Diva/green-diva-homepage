import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ClericCapability } from "../types";
import { withInvocationLogging } from "../types";
import { getSecretOrEnv } from "@/lib/clericSecrets";
import type { StructuredNamingImage, StructuredNamingMediaType } from "./structured-naming";

const SYSTEM_PROMPT = `You are the Lore-Weaver of the Green Diva Sanctuary. Given an item's catalogue entry, photographs of the item, and a few research snippets from the open web, you compose a short evocative lore in BOTH English and Chinese.

Reply with a single JSON object — no prose, no markdown fences — matching this shape:

{
  "loreEn": "1-3 sentences. Mythic / archival register. May cite concrete details visible in the photos. Do NOT fabricate provenance not supported by the snippets or the description.",
  "loreZh": "1-3 句对应中文，意境化，可引用照片中可观察细节。不要编造来源。"
}

Stay grounded: when the snippets are sparse, lean on visual texture (material, wear, ornament). When the snippets are rich, reference the cultural context obliquely — never quote them verbatim.`;

export type WriteLoreInput = {
  nameEn: string;
  nameZh: string;
  classifEn: string;
  classifZh: string;
  description: string;
  snippets: Array<{ url: string; title: string; content: string }>;
  images: StructuredNamingImage[];
};

export type WriteLoreOutput = {
  loreEn: string;
  loreZh: string;
};

async function getClient(): Promise<Anthropic> {
  const key = await getSecretOrEnv("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey: key });
}

const baseCapability: ClericCapability<WriteLoreInput, WriteLoreOutput> = {
  id: "write-lore",
  clericCodename: "DIVA-001",
  metadata: {
    iconKey: "auto_stories",
    nameEn: "Lore Weaver",
    nameZh: "圣记编纂",
    descriptionEn: "Synthesises photos, catalogue fields and research snippets into a short bilingual lore entry.",
    descriptionZh: "综合照片、归档字段与检索片段，撰写简短中英 lore。",
    provider: "anthropic",
    requiredEnvVars: ["ANTHROPIC_API_KEY"],
    autonomyLevel: 1,
  },
  serializeInput(input) {
    return {
      nameEn: input.nameEn,
      classifEn: input.classifEn,
      descriptionLength: input.description.length,
      imageCount: input.images.length,
      snippetCount: input.snippets.length,
      snippetDomains: Array.from(
        new Set(
          input.snippets
            .map((s) => safeHostname(s.url))
            .filter((d) => d !== "(unknown)"),
        ),
      ).slice(0, 8),
    };
  },
  async run(cleric, input) {
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

    const snippetBlock = input.snippets.length
      ? input.snippets
          .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.content}`)
          .join("\n\n---\n\n")
      : "(no web snippets returned)";

    userBlocks.push({
      type: "text",
      text: [
        `Catalogue entry:`,
        `- nameEn: ${input.nameEn}`,
        `- nameZh: ${input.nameZh}`,
        `- classifEn: ${input.classifEn}`,
        `- classifZh: ${input.classifZh}`,
        ``,
        `Curator description:`,
        input.description.trim() || "(none)",
        ``,
        `Web research snippets:`,
        snippetBlock,
      ].join("\n"),
    });

    const overlay = (cleric.systemPrompt ?? "").trim();
    const systemText = overlay
      ? `${SYSTEM_PROMPT}\n\n--- Style overlay (do not break the JSON contract above) ---\n${overlay}`
      : SYSTEM_PROMPT;

    const resp = await c.messages.create({
      model: cleric.model ?? "claude-haiku-4-5-20251001",
      max_tokens: cleric.maxTokens ?? 800,
      temperature: cleric.temperature ?? 0.7,
      system: [
        { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
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
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI did not return JSON");
    const parsed = JSON.parse(m[0]);
    const out: WriteLoreOutput = {
      loreEn: String(parsed.loreEn ?? "").slice(0, 1000),
      loreZh: String(parsed.loreZh ?? "").slice(0, 1000),
    };
    if (!out.loreEn || !out.loreZh) throw new Error("AI returned empty lore");
    return out;
  },
};

export const writeLoreCapability = withInvocationLogging(baseCapability);

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unknown)";
  }
}
