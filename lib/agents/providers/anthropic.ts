import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSecretOrEnv } from "@/lib/agentSecrets";

async function getClient(): Promise<Anthropic> {
  const key = await getSecretOrEnv("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey: key });
}

function inputToText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (typeof obj.prompt === "string") return obj.prompt;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.message === "string") return obj.message;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export async function callAnthropic(args: {
  model: string | null | undefined;
  systemPrompt: string | null | undefined;
  input: unknown;
  maxTokens: number | null | undefined;
  temperature: number | null | undefined;
}): Promise<unknown> {
  const c = await getClient();
  const text = inputToText(args.input);
  const resp = await c.messages.create({
    model: args.model ?? "claude-haiku-4-5-20251001",
    max_tokens: args.maxTokens ?? 1024,
    temperature: args.temperature ?? 0.7,
    system: args.systemPrompt
      ? [
          {
            type: "text",
            text: args.systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ]
      : undefined,
    messages: [{ role: "user", content: text }],
  });

  const replyText = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return {
    text: replyText,
    model: resp.model,
    stopReason: resp.stop_reason,
    usage: {
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
    },
  };
}
