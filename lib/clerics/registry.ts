import "server-only";
import type { AgentCapability } from "./types";
import { AgentCapabilityNotFound } from "./types";
import { DIVA_001_CAPABILITIES } from "./diva-001";

const REGISTRY: Record<string, Record<string, AgentCapability<unknown, unknown>>> = {
  "DIVA-001": DIVA_001_CAPABILITIES,
};

export function listAgentCapabilities(codename: string): string[] {
  return Object.keys(REGISTRY[codename] ?? {});
}

export function getRawCapability(
  codename: string,
  capabilityId: string,
): AgentCapability<unknown, unknown> {
  const cap = REGISTRY[codename]?.[capabilityId];
  if (!cap) throw new AgentCapabilityNotFound(codename, capabilityId);
  return cap;
}
