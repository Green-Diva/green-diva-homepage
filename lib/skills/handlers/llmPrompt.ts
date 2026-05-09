// LLM_PROMPT handler — Anthropic + OpenAI.
//
// handlerConfig:
//   {
//     provider?: "anthropic" | "openai",  // default "anthropic"
//     model: string,                      // e.g. "claude-opus-4-7" / "gpt-4o"
//     systemPrompt?: string,              // can contain {{vars}}
//     userTemplate?: string,              // can contain {{vars}}; if omitted, input is JSON-stringified
//     maxTokens?: number,                 // default 1024
//     temperature?: number,               // omit by default (some 4.x models reject it)
//     responseFormat?: "text"|"json",     // default "text" → returns { text }; "json" attempts JSON.parse
//     authEnv?: string,                   // default per-provider: ANTHROPIC_API_KEY / OPENAI_API_KEY
//     // Vision (Anthropic only for now): the handler reads `input[imagePathsField]`
//     // as an array of absolute server paths, base64-encodes them, and attaches
//     // them to the user message as image content blocks. Capped at 8 images.
//     imagePathsField?: string,           // default null = no vision
//   }

import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { HandlerError, type SkillHandler } from "../types";

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB per image
const IMAGE_MIME: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

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

type AnthropicImage = { mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };

async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  systemText: string | undefined;
  userText: string;
  maxTokens: number;
  temperature: number | undefined;
  images?: AnthropicImage[];
}): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  // Anthropic message content: image blocks first, then text — empirically the
  // model attends to text better when images precede it.
  const userContent: Anthropic.Messages.ContentBlockParam[] = [];
  for (const img of opts.images ?? []) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: img.mime, data: img.base64 },
    });
  }
  userContent.push({ type: "text", text: opts.userText });
  let response;
  try {
    response = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      system: opts.systemText,
      messages: [{ role: "user", content: userContent }],
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

  // Vision: pull image paths from a configured input field. Vision only
  // supported by Anthropic in this handler — silently ignored for OpenAI.
  let images: AnthropicImage[] | undefined;
  if (provider === "anthropic" && typeof config.imagePathsField === "string") {
    // Supports dot-paths so it works under DAG merge inputs, e.g.
    // "files.imageAbsPaths" when input is { files: {...}, classify: {...} }.
    const raw = getPath(input, config.imagePathsField);
    if (Array.isArray(raw)) {
      images = await loadImages(raw);
    }
  }

  const text =
    provider === "anthropic"
      ? await callAnthropic({ apiKey, model, systemText, userText, maxTokens, temperature, images })
      : await callOpenAI({ apiKey, model, systemText, userText, maxTokens, temperature });

  if (config.responseFormat === "json") {
    // Models occasionally wrap JSON in ```json fences; strip if present.
    const cleaned = stripCodeFence(text);
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new HandlerError("LLM_PROMPT: response was not valid JSON", "OUTPUT_PARSE");
    }
  }
  return { text };
};

function stripCodeFence(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : trimmed;
}

async function loadImages(paths: unknown[]): Promise<AnthropicImage[]> {
  const out: AnthropicImage[] = [];
  for (const p of paths.slice(0, MAX_IMAGES)) {
    if (typeof p !== "string") continue;
    const ext = path.extname(p).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) continue;
    try {
      const stat = await fs.stat(p);
      if (stat.size > MAX_IMAGE_BYTES) continue; // skip oversized
      const buf = await fs.readFile(p);
      out.push({ mime, base64: buf.toString("base64") });
    } catch {
      // missing/unreadable — skip silently; the model will see fewer images
    }
  }
  return out;
}
