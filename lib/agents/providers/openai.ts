import "server-only";

export async function callOpenAI(_args: {
  model: string | null | undefined;
  systemPrompt: string | null | undefined;
  input: unknown;
  maxTokens: number | null | undefined;
  temperature: number | null | undefined;
}): Promise<unknown> {
  void _args;
  throw new Error("OpenAI provider is not configured. Install openai and wire it up here.");
}
