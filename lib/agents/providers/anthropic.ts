import "server-only";

export async function callAnthropic(_args: {
  model: string | null | undefined;
  systemPrompt: string | null | undefined;
  input: unknown;
  maxTokens: number | null | undefined;
  temperature: number | null | undefined;
}): Promise<unknown> {
  void _args;
  throw new Error("Anthropic provider is not configured. Install @anthropic-ai/sdk and wire it up here.");
}
