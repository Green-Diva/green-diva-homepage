import "server-only";
import type { Cleric } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ClericCapabilityMeta } from "./capabilityTypes";

export type { ClericCapabilityMeta };

export interface ClericCapability<TInput, TOutput> {
  id: string;
  clericCodename: string;
  metadata: ClericCapabilityMeta;
  run(cleric: Cleric, input: TInput): Promise<TOutput>;
  serializeInput?(input: TInput): unknown;
  serializeOutput?(output: TOutput): unknown;
}

export class ClericCapabilityNotFound extends Error {
  constructor(codename: string, capabilityId: string) {
    super(`Cleric ${codename} does not provide capability '${capabilityId}'`);
    this.name = "ClericCapabilityNotFound";
  }
}

export function withInvocationLogging<I, O>(
  capability: ClericCapability<I, O>,
): ClericCapability<I, O> {
  return {
    id: capability.id,
    clericCodename: capability.clericCodename,
    metadata: capability.metadata,
    serializeInput: capability.serializeInput,
    serializeOutput: capability.serializeOutput,
    async run(cleric, input) {
      const startedAt = Date.now();
      let output: O | undefined;
      let ok = false;
      let errorMessage: string | null = null;
      try {
        output = await capability.run(cleric, input);
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
        prisma.clericInvocation
          .create({
            data: {
              clericId: cleric.id,
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
