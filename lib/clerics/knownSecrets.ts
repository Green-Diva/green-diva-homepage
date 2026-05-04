import "server-only";
import { listClericCapabilities, getRawCapability } from "./registry";

const REGISTERED_CODENAMES = ["DIVA-001"] as const;

/**
 * Single source of truth for which env-var names admins are allowed to set
 * via the UI. Derived from the `requiredEnvVars` declared on each registered
 * capability. Any new capability that adds a `requiredEnvVars` entry becomes
 * configurable automatically — no extra wiring.
 */
function buildKnownSecrets(): string[] {
  const seen = new Set<string>();
  for (const codename of REGISTERED_CODENAMES) {
    for (const capId of listClericCapabilities(codename)) {
      const cap = getRawCapability(codename, capId);
      for (const v of cap.metadata.requiredEnvVars) seen.add(v);
    }
  }
  return Array.from(seen).sort();
}

export const ALL_KNOWN_CAPABILITY_SECRETS: string[] = buildKnownSecrets();

const KNOWN_SET = new Set(ALL_KNOWN_CAPABILITY_SECRETS);

export function isKnownSecretName(name: string): boolean {
  return KNOWN_SET.has(name);
}
