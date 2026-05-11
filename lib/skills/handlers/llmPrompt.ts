// LLM_PROMPT handler — Anthropic + OpenAI + Gemini.
//
// handlerConfig:
//   {
//     provider?: "anthropic" | "openai" | "gemini",  // default "anthropic"
//     model: string,                                 // e.g. "claude-opus-4-7" / "gpt-4o" / "gemini-2.5-flash"
//     systemPrompt?: string,                         // can contain {{vars}}
//     userTemplate?: string,                         // can contain {{vars}}; if omitted, input is JSON-stringified
//     maxTokens?: number,                            // default 1024
//     temperature?: number,                          // omit by default (some 4.x models reject it)
//     responseFormat?: "text"|"json",                // default "text" → returns { text }; "json" attempts JSON.parse
//     authEnv?: string,                              // default per-provider:
//                                                    //   anthropic → ANTHROPIC_API_KEY
//                                                    //   openai    → OPENAI_API_KEY
//                                                    //   gemini    → GEMINI_API_KEY
//     // Vision: the handler reads `input[imagePathsField]` as an array of
//     // absolute server paths, base64-encodes them, and attaches them to the
//     // user message as image parts. Anthropic and Gemini both supported;
//     // silently no-op for OpenAI in this iteration. Capped at 8 images.
//     imagePathsField?: string,                      // default null = no vision
//     // Gemini-only: enable Google Search Grounding. Gemini's JSON-mode is
//     // mutually exclusive with grounding (responseMimeType conflicts with
//     // tools), so when both are requested grounding wins and responseFormat
//     // is degraded to "text". When grounding is on and citations come back,
//     // they're surfaced as `_citations: [{title, url}, ...]` alongside the
//     // primary output (merged into JSON object when responseFormat=json,
//     // attached as a sibling field for text mode).
//     grounding?: boolean,                           // default false
//   }

import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI, type Part as GeminiPart } from "@google/generative-ai";
import { HandlerError, type SkillHandler } from "../types";
import { applyTemplate as applySharedTemplate } from "@/lib/agent-service/template";

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB per image
type ImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const IMAGE_MIME: Record<string, ImageMime> = {
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

// Shared engine (lib/agent-service/template.ts) is the single source of
// truth. systemPrompt / userTemplate are always string→string here, so
// we coerce the result (shared engine may return raw type for whole-
// value `{{x}}` matches).
function applyTemplate(template: string, input: unknown): string {
  const out = applySharedTemplate(template, (input ?? {}) as Record<string, unknown>);
  if (typeof out === "string") return out;
  if (out == null) return "";
  return typeof out === "object" ? JSON.stringify(out) : String(out);
}

// Provider-agnostic image carrier. Each provider's call function turns
// these into its own typed shape (Anthropic image_block / Gemini Part /
// OpenAI image_url — the latter still TODO).
type LoadedImage = { mime: ImageMime; base64: string };

type Citation = { title: string; url: string };

type LlmCallResult = {
  text: string;
  // Gemini-only: present iff grounding was requested AND the response
  // contained groundingMetadata.groundingChunks. Empty array if requested
  // but the model didn't actually search.
  citations?: Citation[];
};

async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  systemText: string | undefined;
  userText: string;
  maxTokens: number;
  temperature: number | undefined;
  images?: LoadedImage[];
}): Promise<LlmCallResult> {
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
  const text = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text };
}

async function callOpenAI(opts: {
  apiKey: string;
  model: string;
  systemText: string | undefined;
  userText: string;
  maxTokens: number;
  temperature: number | undefined;
}): Promise<LlmCallResult> {
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
  return { text: response.choices[0]?.message?.content ?? "" };
}

async function callGemini(opts: {
  apiKey: string;
  model: string;
  systemText: string | undefined;
  userText: string;
  maxTokens: number;
  temperature: number | undefined;
  // Mutually exclusive: when grounding is true, jsonMode is forced off
  // (handled at the caller per the response-format degradation policy).
  jsonMode: boolean;
  grounding: boolean;
  images?: LoadedImage[];
}): Promise<LlmCallResult> {
  const ai = new GoogleGenerativeAI(opts.apiKey);
  const model = ai.getGenerativeModel({
    model: opts.model,
    // Gemini's `tools` slot accepts a built-in Google Search retriever;
    // shape isn't typed in the public SDK so we cast through unknown.
    ...(opts.grounding
      ? { tools: [{ googleSearch: {} } as unknown as never] }
      : {}),
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });

  const parts: GeminiPart[] = [];
  for (const img of opts.images ?? []) {
    parts.push({ inlineData: { mimeType: img.mime, data: img.base64 } });
  }
  parts.push({ text: opts.userText });

  let response;
  try {
    response = await model.generateContent({
      contents: [{ role: "user", parts }],
      systemInstruction: opts.systemText,
    });
  } catch (e) {
    throw new HandlerError(
      `LLM_PROMPT: Gemini call failed${e instanceof Error ? ": " + e.message : ""}`,
      "PROVIDER_ERROR",
    );
  }

  const text = response.response.text() ?? "";

  // Citations only when grounding was requested. Empty array when
  // grounding was on but the model didn't invoke search.
  let citations: Citation[] | undefined;
  if (opts.grounding) {
    const chunks =
      (response.response.candidates?.[0] as unknown as {
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
      })?.groundingMetadata?.groundingChunks ?? [];
    citations = chunks
      .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
      .filter((c) => c.url);
  }

  return { text, citations };
}

export const llmPrompt: SkillHandler = async (input, config) => {
  const provider = typeof config.provider === "string" ? config.provider : "anthropic";
  if (provider !== "anthropic" && provider !== "openai" && provider !== "gemini") {
    throw new HandlerError(
      `LLM_PROMPT: provider "${provider}" not supported (use "anthropic" | "openai" | "gemini")`,
      "INVALID_CONFIG",
    );
  }
  const model = typeof config.model === "string" ? config.model : null;
  if (!model) throw new HandlerError("LLM_PROMPT: model missing in handlerConfig", "INVALID_CONFIG");

  const defaultEnv =
    provider === "anthropic"
      ? "ANTHROPIC_API_KEY"
      : provider === "openai"
        ? "OPENAI_API_KEY"
        : "GEMINI_API_KEY";
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
  const wantJson = config.responseFormat === "json";
  const grounding = provider === "gemini" && config.grounding === true;

  // Vision: pull image paths from a configured input field. Anthropic +
  // Gemini handle images; OpenAI vision skipped this iteration (would need
  // the image_url block format and base64 data-URI assembly).
  let images: LoadedImage[] | undefined;
  const supportsVision = provider === "anthropic" || provider === "gemini";
  if (supportsVision && typeof config.imagePathsField === "string") {
    // Supports dot-paths so it works under DAG merge inputs, e.g.
    // "files.imageAbsPaths" when input is { files: {...}, classify: {...} }.
    const raw = getPath(input, config.imagePathsField);
    if (Array.isArray(raw)) {
      images = await loadImages(raw);
    }
  }

  let result: LlmCallResult;
  if (provider === "anthropic") {
    result = await callAnthropic({ apiKey, model, systemText, userText, maxTokens, temperature, images });
  } else if (provider === "openai") {
    result = await callOpenAI({ apiKey, model, systemText, userText, maxTokens, temperature });
  } else {
    result = await callGemini({
      apiKey,
      model,
      systemText,
      userText,
      maxTokens,
      temperature,
      // Gemini API rejects responseMimeType together with tools — degrade
      // JSON mode when grounding wins. Caller's outputSchema validation
      // (in lib/skills/invoke.ts) will catch the resulting shape mismatch
      // if the prompt didn't ask for prose.
      jsonMode: wantJson && !grounding,
      grounding,
      images,
    });
  }

  if (wantJson && !(provider === "gemini" && grounding)) {
    // Models occasionally wrap JSON in ```json fences; strip if present.
    const cleaned = stripCodeFence(result.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new HandlerError("LLM_PROMPT: response was not valid JSON", "OUTPUT_PARSE");
    }
    // Splice citations into the JSON object when present (and the parsed
    // value is an object — for arrays / primitives we don't pollute).
    if (result.citations !== undefined && isObject(parsed)) {
      return { ...parsed, _citations: result.citations };
    }
    return parsed;
  }

  // Text mode (or grounded Gemini that couldn't honor JSON): return
  // { text, _citations? }.
  if (result.citations !== undefined) {
    return { text: result.text, _citations: result.citations };
  }
  return { text: result.text };
};

function stripCodeFence(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : trimmed;
}

async function loadImages(paths: unknown[]): Promise<LoadedImage[]> {
  const out: LoadedImage[] = [];
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
