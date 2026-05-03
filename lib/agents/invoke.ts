import "server-only";
import { prisma } from "@/lib/db";
import type { AgentInvokeResult, AgentInvokeSource } from "@/lib/agentTypes";
import { callEcho } from "./providers/echo";
import { callInternal } from "./providers/internal";
import { callAnthropic } from "./providers/anthropic";
import { callOpenAI } from "./providers/openai";

const ERROR_MESSAGE_MAX_LEN = 500;

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export async function invokeAgent(
  codename: string,
  input: unknown,
  ctx?: { source?: AgentInvokeSource; callerUserId?: string | null },
): Promise<AgentInvokeResult> {
  const source = ctx?.source ?? "internal";
  const callerUserId = ctx?.callerUserId ?? null;
  const startedAt = Date.now();

  const agent = await prisma.agent.findUnique({ where: { codename } });
  if (!agent) {
    return {
      ok: false,
      error: "agent not found",
      latencyMs: Date.now() - startedAt,
      invocationId: null,
    };
  }

  if (!agent.enabled || agent.status === "OFFLINE") {
    const inv = await prisma.agentInvocation.create({
      data: {
        agentId: agent.id,
        callerUserId,
        source,
        inputJson: safeStringify(input),
        ok: false,
        errorMessage: "agent disabled or offline",
        latencyMs: Date.now() - startedAt,
      },
    });
    return {
      ok: false,
      error: "agent disabled or offline",
      latencyMs: inv.latencyMs ?? Date.now() - startedAt,
      invocationId: inv.id,
    };
  }

  let output: unknown;
  let errorMessage: string | null = null;
  let ok = false;
  try {
    switch (agent.provider) {
      case "ECHO":
        output = await callEcho(input);
        break;
      case "INTERNAL":
        output = await callInternal(agent.internalHandler, input);
        break;
      case "ANTHROPIC":
        output = await callAnthropic({
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          input,
          maxTokens: agent.maxTokens,
          temperature: agent.temperature,
        });
        break;
      case "OPENAI":
        output = await callOpenAI({
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          input,
          maxTokens: agent.maxTokens,
          temperature: agent.temperature,
        });
        break;
      default:
        throw new Error(`unknown provider: ${String(agent.provider)}`);
    }
    ok = true;
  } catch (e) {
    console.error(`[agents/invoke] ${codename} failed`, e);
    errorMessage = clamp(e instanceof Error ? e.message : String(e), ERROR_MESSAGE_MAX_LEN);
  }

  const latencyMs = Date.now() - startedAt;
  const inv = await prisma.agentInvocation.create({
    data: {
      agentId: agent.id,
      callerUserId,
      source,
      inputJson: safeStringify(input),
      outputJson: ok ? safeStringify(output) : null,
      ok,
      errorMessage,
      latencyMs,
    },
  });

  if (ok) {
    return { ok: true, output, latencyMs, invocationId: inv.id };
  }
  return {
    ok: false,
    error: "invocation failed",
    latencyMs,
    invocationId: inv.id,
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "null";
  } catch {
    return JSON.stringify(String(v));
  }
}
