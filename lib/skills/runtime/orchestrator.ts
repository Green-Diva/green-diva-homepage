// Orchestrator (AUTONOMOUS) runtime — Phase 4.
//
// Pattern: hand the equipped skills to an LLM as tools, let the model
// decide what to call. Run a tool-use loop until either (a) the model
// stops emitting tool_use blocks, or (b) maxIterations is reached.
//
// Supports two providers: Anthropic (default) and OpenAI. Tool definitions
// are converted from each Skill's inputSchema; missing or null inputSchema
// falls back to an empty-object schema so the LLM can call with no args.
//
// runLog entries: one per tool invocation (stepId = "iter-N.tool-M"),
// matching Phase 3's per-step shape so AgentJobDrawer renders them
// uniformly.
//
// outputMode (dispatcherConfig):
//   - "text" (default) → output = { text, iterations, toolCallCount }.
//                        Free-form conversation; scene.outputSchema validation
//                        will fail unless the scene expects `{ text }`.
//   - "json"           → orchestrator attempts JSON.parse on the trimmed final
//                        text. On success the parsed object becomes the agent
//                        output (consumable by scene.outputSchema + writeback
//                        hook). On failure falls back to "text" shape with a
//                        runLog warning. systemPrompt is auto-augmented with a
//                        "JSON only, no prose" suffix so reliability is
//                        acceptable for simple sync scenes; for high-stakes
//                        contracts prefer MECHANICAL with a tail transform.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Skill } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invokeSkill } from "@/lib/skills/invoke";
import type { AgentRunResult, AgentRunLogEntry } from "@/lib/agents/invoke";
import { AgentErrorCode } from "@/lib/agent-errors";

type OutputMode = "text" | "json";

type DispatcherConfig = {
  version: number;
  provider: "anthropic" | "openai";
  model: string;
  systemPrompt?: string;
  maxIterations?: number;
  temperature?: number;
  authEnv?: string;
  outputMode?: OutputMode;
};

// Appended to systemPrompt when outputMode === "json". Kept terse — bigger
// instructions belong in the admin-authored systemPrompt itself.
const JSON_MODE_SUFFIX =
  "\n\nIMPORTANT — Output format:\n" +
  "After you have finished calling tools, your final assistant message MUST be a single valid JSON object (or array) and nothing else. " +
  "No markdown fences, no commentary, no leading/trailing prose. " +
  "The JSON shape must match the contract the caller expects.";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateDispatcherConfig(
  cfg: unknown,
): { ok: true; config: DispatcherConfig } | { ok: false; code: AgentErrorCode; message: string } {
  if (!isObject(cfg)) {
    return { ok: false, code: "DISPATCHER_MISSING", message: "dispatcherConfig is empty — set up the Orchestrator before invoking" };
  }
  if (cfg.version !== 1) {
    return { ok: false, code: "DISPATCHER_VERSION", message: `dispatcherConfig.version must be 1 (got ${String(cfg.version)})` };
  }
  if (cfg.provider !== "anthropic" && cfg.provider !== "openai") {
    return { ok: false, code: "DISPATCHER_INVALID", message: `dispatcherConfig.provider must be "anthropic" or "openai" (got ${String(cfg.provider)})` };
  }
  if (typeof cfg.model !== "string" || !cfg.model) {
    return { ok: false, code: "DISPATCHER_INVALID", message: "dispatcherConfig.model is required" };
  }
  if (cfg.outputMode !== undefined && cfg.outputMode !== "text" && cfg.outputMode !== "json") {
    return { ok: false, code: "DISPATCHER_INVALID", message: `dispatcherConfig.outputMode must be "text" or "json" (got ${String(cfg.outputMode)})` };
  }
  return { ok: true, config: cfg as unknown as DispatcherConfig };
}

// Stable LLM tool name. Prefers the explicit Skill.slug column (kebab-case,
// admin-controlled) so renaming nameEn doesn't invalidate prompt caches or
// break tool_use history. Falls back to a derived snake_case from nameEn +
// cuid suffix for legacy rows that haven't been backfilled yet. Both
// Anthropic and OpenAI accept [a-zA-Z0-9_-]{1,64}.
function toolNameFor(skill: Skill): string {
  if (skill.slug) return skill.slug.slice(0, 64);
  const derived = skill.nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  const suffix = skill.id.slice(-6);
  return `${derived || "skill"}_${suffix}`;
}

function inputSchemaFor(skill: Skill): Record<string, unknown> {
  if (skill.inputSchema && isObject(skill.inputSchema)) {
    return skill.inputSchema as Record<string, unknown>;
  }
  // Empty-object schema so providers that *require* a schema accept it.
  return { type: "object", properties: {} };
}

// Truncate tool result content for LLM context. JSON.stringify can produce
// very large blobs — caps cost and prevents runaway message history growth.
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[truncated ${s.length - max} chars]`;
}

const TOOL_RESULT_MAX = 8000;

export async function runOrchestrator(opts: {
  agentId: string;
  input: unknown;
  dispatcherConfig: unknown;
}): Promise<AgentRunResult> {
  const v = validateDispatcherConfig(opts.dispatcherConfig);
  if (!v.ok) {
    return { ok: false, errorCode: v.code, errorMessage: v.message, runLog: [] };
  }
  const config = v.config;

  const defaultEnv = config.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const envName = config.authEnv && typeof config.authEnv === "string" ? config.authEnv : defaultEnv;
  const apiKey = process.env[envName];
  if (!apiKey) {
    return {
      ok: false,
      errorCode: "MISSING_ENV",
      errorMessage: `Orchestrator: env "${envName}" not set on server`,
      runLog: [],
    };
  }

  // Load equipped skills with slots set, in slot order.
  const equips = await prisma.agentSkillEquip.findMany({
    where: { agentId: opts.agentId, slotIndex: { not: null } },
    include: { skill: true },
    orderBy: [{ slotIndex: "asc" }],
  });
  const usableEquips = equips.filter((e) => e.skill.status === "ONLINE");
  if (usableEquips.length === 0) {
    return {
      ok: false,
      errorCode: "NO_TOOLS",
      errorMessage: "No ONLINE skills equipped — orchestrator has nothing to call",
      runLog: [],
    };
  }

  // Runtime index built from this agent's equipped ONLINE skills.
  const equippedSkillIndex = new Map<string, Skill>();
  for (const e of usableEquips) equippedSkillIndex.set(toolNameFor(e.skill), e.skill);

  const maxIter = typeof config.maxIterations === "number" ? Math.min(50, Math.max(1, config.maxIterations)) : 10;
  const temperature = typeof config.temperature === "number" ? config.temperature : 1.0;
  const outputMode: OutputMode = config.outputMode ?? "text";

  // Augment systemPrompt with JSON-only instruction when caller expects a
  // structured object (typical for scene.outputSchema contracts). The suffix
  // is small and tolerates an empty/missing user-authored systemPrompt.
  const effectiveSystemPrompt =
    outputMode === "json"
      ? (config.systemPrompt ?? "") + JSON_MODE_SUFFIX
      : config.systemPrompt;

  const initialUserText =
    typeof opts.input === "string"
      ? opts.input
      : JSON.stringify(opts.input ?? {});

  const runLog: AgentRunLogEntry[] = [];

  // Shared per-tool invocation: looks up the Skill, calls invokeSkill, records
  // a runLog entry, and returns the stringified content the LLM will see.
  async function invokeTool(toolName: string, input: unknown, iter: number, idx: number): Promise<string> {
    const stepId = `iter-${iter + 1}.tool-${idx + 1}`;
    const startedAt = new Date();
    const startedAtMs = Date.now();
    const skill = equippedSkillIndex.get(toolName);
    if (!skill) {
      const message = `LLM called unknown tool "${toolName}"`;
      runLog.push({
        stepId,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        ok: false,
        errorCode: "UNKNOWN_TOOL",
        errorMessage: message,
      });
      return `error: ${message}`;
    }
    const result = await invokeSkill(skill, input);
    const endedAt = new Date();
    if (result.ok) {
      runLog.push({
        stepId,
        skillId: skill.id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAtMs,
        ok: true,
        output: result.output,
      });
      return truncate(JSON.stringify(result.output ?? null), TOOL_RESULT_MAX);
    }
    runLog.push({
      stepId,
      skillId: skill.id,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAtMs,
      ok: false,
      errorCode: result.errorCode,
      errorMessage: result.errors.join("; "),
      output: result.output,
    });
    // Surface the error back to the model so it can decide to retry / give up.
    return `error: ${result.errorCode}: ${result.errors.join("; ")}`;
  }

  try {
    const out =
      config.provider === "anthropic"
        ? await runAnthropicLoop({
            apiKey,
            model: config.model,
            systemPrompt: effectiveSystemPrompt,
            temperature,
            maxIter,
            equips: usableEquips,
            initialUserText,
            invokeTool,
          })
        : await runOpenAILoop({
            apiKey,
            model: config.model,
            systemPrompt: effectiveSystemPrompt,
            temperature,
            maxIter,
            equips: usableEquips,
            initialUserText,
            invokeTool,
          });
    return { ok: true, output: shapeOutput(out, outputMode, runLog), runLog };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errorCode: "PROVIDER_ERROR",
      errorMessage: `${config.provider} call failed: ${message}`,
      runLog,
    };
  }
}

type LoopOutput = { text: string; iterations: number; toolCallCount: number };

// Convert the raw loop result into the agent output shape.
//
// - "text" mode: preserves the legacy `{ text, iterations, toolCallCount }`
//   envelope. scene.outputSchema must explicitly accept that shape (rare —
//   most scenes want a structured object).
// - "json" mode: JSON.parse the trimmed text. Success → the parsed value
//   IS the agent output (consumable by scene.outputSchema + writeback
//   hook); failure → falls back to the text envelope and pushes a runLog
//   entry so the failure is visible in AgentJobDrawer.
//
// `_text` / `_iterations` / `_toolCallCount` are merged into successful JSON
// objects as a passive audit trail (lets AgentJobDrawer still show iteration
// counts; scene.outputSchema with `.passthrough()` allows these through).
function shapeOutput(
  out: LoopOutput,
  mode: OutputMode,
  runLog: AgentRunLogEntry[],
): unknown {
  if (mode !== "json") {
    return { text: out.text, iterations: out.iterations, toolCallCount: out.toolCallCount };
  }
  const trimmed = out.text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences if the LLM ignored instructions.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (stripped && (stripped.startsWith("{") || stripped.startsWith("["))) {
    try {
      const parsed = JSON.parse(stripped) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          ...(parsed as Record<string, unknown>),
          _iterations: out.iterations,
          _toolCallCount: out.toolCallCount,
        };
      }
      return parsed;
    } catch (e) {
      runLog.push({
        stepId: "output-parse",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 0,
        ok: false,
        errorCode: "OUTPUT_PARSE_FAILED",
        errorMessage: `outputMode=json but final text isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  } else if (stripped) {
    runLog.push({
      stepId: "output-parse",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      ok: false,
      errorCode: "OUTPUT_NOT_JSON",
      errorMessage: "outputMode=json but final text doesn't start with { or [",
    });
  }
  // Fallback so the AgentJob row still has a parseable output column.
  return { text: out.text, iterations: out.iterations, toolCallCount: out.toolCallCount };
}

type LoopOpts = {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  temperature: number;
  maxIter: number;
  equips: Array<{ skill: Skill }>;
  initialUserText: string;
  invokeTool: (toolName: string, input: unknown, iter: number, idx: number) => Promise<string>;
};

async function runAnthropicLoop(opts: LoopOpts): Promise<LoopOutput> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const tools: Anthropic.Tool[] = opts.equips.map((e) => ({
    name: toolNameFor(e.skill),
    description: e.skill.descriptionEn || undefined,
    input_schema: inputSchemaFor(e.skill) as Anthropic.Tool["input_schema"],
  }));

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.initialUserText }];
  let textOut = "";
  let toolCallCount = 0;

  for (let iter = 0; iter < opts.maxIter; iter += 1) {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: 4096,
      temperature: opts.temperature,
      system: opts.systemPrompt,
      messages,
      tools,
    });

    // Echo assistant content into history so subsequent tool_results are
    // anchored to the right tool_use ids.
    messages.push({ role: "assistant", content: response.content });

    const textBlocks = response.content.filter(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
    );
    const toolBlocks = response.content.filter(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );
    textOut += textBlocks.map((b) => b.text).join("");

    if (toolBlocks.length === 0) {
      return { text: textOut, iterations: iter + 1, toolCallCount };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (let i = 0; i < toolBlocks.length; i += 1) {
      const tu = toolBlocks[i];
      toolCallCount += 1;
      const content = await opts.invokeTool(tu.name, tu.input, iter, i);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { text: textOut, iterations: opts.maxIter, toolCallCount };
}

async function runOpenAILoop(opts: LoopOpts): Promise<LoopOutput> {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const tools: OpenAI.Chat.ChatCompletionTool[] = opts.equips.map((e) => ({
    type: "function",
    function: {
      name: toolNameFor(e.skill),
      description: e.skill.descriptionEn || undefined,
      parameters: inputSchemaFor(e.skill) as Record<string, unknown>,
    },
  }));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: opts.initialUserText });

  let textOut = "";
  let toolCallCount = 0;

  for (let iter = 0; iter < opts.maxIter; iter += 1) {
    const response = await client.chat.completions.create({
      model: opts.model,
      messages,
      temperature: opts.temperature,
      tools,
      max_tokens: 4096,
    });

    const choice = response.choices[0];
    const msg = choice?.message;
    if (!msg) {
      return { text: textOut, iterations: iter + 1, toolCallCount };
    }

    const assistantPush: OpenAI.Chat.ChatCompletionMessageParam = {
      role: "assistant",
      content: msg.content ?? null,
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    } as OpenAI.Chat.ChatCompletionMessageParam;
    messages.push(assistantPush);

    if (msg.content) textOut += msg.content;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { text: textOut, iterations: iter + 1, toolCallCount };
    }

    for (let i = 0; i < toolCalls.length; i += 1) {
      const tc = toolCalls[i];
      if (tc.type !== "function") continue;
      toolCallCount += 1;
      let parsedArgs: unknown = {};
      try {
        parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        // OpenAI sometimes emits malformed JSON; surface as empty input
        // so invokeSkill returns INPUT_SCHEMA_VIOLATION rather than crash.
        parsedArgs = {};
      }
      const content = await opts.invokeTool(tc.function.name, parsedArgs, iter, i);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content,
      });
    }
  }

  return { text: textOut, iterations: opts.maxIter, toolCallCount };
}
