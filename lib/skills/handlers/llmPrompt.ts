// LLM_PROMPT handler — Anthropic + OpenAI (added Phase 4).
//
// handlerConfig:
//   {
//     provider?: "anthropic" | "openai",  // default "anthropic"
//     model: string,                      // e.g. "claude-opus-4-7" / "gpt-4o"
//     systemPrompt?: string,              // can contain {{vars}}
//     userTemplate?: string,              // can contain {{vars}}; if omitted, input is JSON-stringified
//     maxTokens?: number,                 // default 1024
//     temperature?: number,               // default 1.0
//     responseFormat?: "text"|"json",     // default "text" → returns { text }; "json" attempts JSON.parse
//     authEnv?: string,                   // default per-provider: ANTHROPIC_API_KEY / OPENAI_API_KEY
//   }

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { HandlerError, type SkillHandler } from "../types";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function applyTemplate(template: string, input: unknown): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g, (_m, path: string) => {
    const v = getPath(input, path);
    if (v === undefined || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  systemText: string | undefined;
  userText: string;
  maxTokens: number;
  temperature: number | undefined;
}): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  let response;
  try {
    response = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      system: opts.systemText,
      messages: [{ role: "user", content: opts.userText }],
    });
  } catch (e) {
    throw new HandlerError(
      `LLM_PROMPT: Anthropic call failed${e instanceof Error ? ": " + e.message : ""}`,
      "PROVIDER_ERROR",
    );
  }
  return response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function callOpenAI(opts: {
  apiKey: string;
  model: string;
  systemText: string | undefined;
  userText: string;
  maxTokens: number;
  temperature: number | undefined;
}): Promise<string> {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (opts.systemText) messages.push({ role: "system", content: opts.systemText });
  messages.push({ role: "user", content: opts.userText });

  let response;
  try {
    response = await client.chat.completions.create({
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    });
  } catch (e) {
    throw new HandlerError(
      `LLM_PROMPT: OpenAI call failed${e instanceof Error ? ": " + e.message : ""}`,
      "PROVIDER_ERROR",
    );
  }
  return response.choices[0]?.message?.content ?? "";
}

export const llmPrompt: SkillHandler = async (input, config) => {
  const provider = typeof config.provider === "string" ? config.provider : "anthropic";
  if (provider !== "anthropic" && provider !== "openai") {
    throw new HandlerError(
      `LLM_PROMPT: provider "${provider}" not supported (use "anthropic" or "openai")`,
      "INVALID_CONFIG",
    );
  }
  const model = typeof config.model === "string" ? config.model : null;
  if (!model) throw new HandlerError("LLM_PROMPT: model missing in handlerConfig", "INVALID_CONFIG");

  const defaultEnv = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const envName = typeof config.authEnv === "string" && config.authEnv ? config.authEnv : defaultEnv;
  const apiKey = process.env[envName];
  if (!apiKey) throw new HandlerError(`LLM_PROMPT: env "${envName}" not set on server`, "MISSING_ENV");

  const userText = typeof config.userTemplate === "string"
    ? applyTemplate(config.userTemplate, input)
    : isObject(input) || Array.isArray(input)
      ? JSON.stringify(input)
      : String(input ?? "");

  const systemText = typeof config.systemPrompt === "string"
    ? applyTemplate(config.systemPrompt, input)
    : undefined;

  const maxTokens = typeof config.maxTokens === "number" ? config.maxTokens : 1024;
  const temperature = typeof config.temperature === "number" ? config.temperature : undefined;

  const text =
    provider === "anthropic"
      ? await callAnthropic({ apiKey, model, systemText, userText, maxTokens, temperature })
      : await callOpenAI({ apiKey, model, systemText, userText, maxTokens, temperature });

  if (config.responseFormat === "json") {
    try {
      return JSON.parse(text);
    } catch {
      throw new HandlerError("LLM_PROMPT: response was not valid JSON", "OUTPUT_PARSE");
    }
  }
  return { text };
};
