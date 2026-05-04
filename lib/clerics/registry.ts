import "server-only";
import type { ClericCapability } from "./types";
import { ClericCapabilityNotFound } from "./types";
import { DIVA_001_CAPABILITIES } from "./diva-001";

const REGISTRY: Record<string, Record<string, ClericCapability<unknown, unknown>>> = {
  "DIVA-001": DIVA_001_CAPABILITIES,
};

export function listClericCapabilities(codename: string): string[] {
  return Object.keys(REGISTRY[codename] ?? {});
}

export function getRawCapability(
  codename: string,
  capabilityId: string,
): ClericCapability<unknown, unknown> {
  const cap = REGISTRY[codename]?.[capabilityId];
  if (!cap) throw new ClericCapabilityNotFound(codename, capabilityId);
  return cap;
}
