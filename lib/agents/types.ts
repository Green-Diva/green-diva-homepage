import "server-only";
import type { Agent } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AgentCapabilityMeta } from "./capabilityTypes";

export type { AgentCapabilityMeta };

export interface AgentCapability<TInput, TOutput> {
  id: string;
  agentCodename: string;
  metadata: AgentCapabilityMeta;
  run(agent: Agent, input: TInput): Promise<TOutput>;
  serializeInput?(input: TInput): unknown;
  serializeOutput?(output: TOutput): unknown;
}

export class AgentCapabilityNotFound extends Error {
  constructor(codename: string, capabilityId: string) {
    super(`Agent ${codename} does not provide capability '${capabilityId}'`);
    this.name = "AgentCapabilityNotFound";
  }
}

export function withInvocationLogging<I, O>(
  capability: AgentCapability<I, O>,
): AgentCapability<I, O> {
  return {
    id: capability.id,
    agentCodename: capability.agentCodename,
    metadata: capability.metadata,
    serializeInput: capability.serializeInput,
    serializeOutput: capability.serializeOutput,
    async run(agent, input) {
      const startedAt = Date.now();
      let output: O | undefined;
      let ok = false;
      let errorMessage: string | null = null;
      try {
        output = await capability.run(agent, input);
        ok = true;
        return output;
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        const latencyMs = Date.now() - startedAt;
        const serializedInput = capability.serializeInput
          ? capability.serializeInput(input)
          : input;
        const serializedOutput = ok && output !== undefined && capability.serializeOutput
          ? capability.serializeOutput(output)
          : output;
        prisma.agentInvocation
          .create({
            data: {
              agentId: agent.id,
              source: `capability:${capability.id}`,
              inputJson: safeStringify(serializedInput),
              outputJson: ok ? safeStringify(serializedOutput) : null,
              ok,
              errorMessage,
              latencyMs,
            },
          })
          .catch((logErr) => {
            console.error("[capability/log] failed", { capability: capability.id, e: logErr });
          });
      }
    },
  };
}

const INVOCATION_JSON_MAX = 4000;

function safeStringify(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? "null";
  } catch {
    s = String(v);
  }
  return s.length > INVOCATION_JSON_MAX
    ? s.slice(0, INVOCATION_JSON_MAX) + "…[truncated]"
    : s;
}
