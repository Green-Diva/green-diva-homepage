import "server-only";
import type { AgentCapability } from "../types";
import { structuredNamingCapability } from "./structured-naming";
import { removeBgCapability } from "./remove-bg";
import { webResearchCapability } from "./web-research";
import { writeLoreCapability } from "./write-lore";
import { imageTo3dCapability } from "./image-to-3d";

export const DIVA_001_CAPABILITIES: Record<string, AgentCapability<unknown, unknown>> = {
  [structuredNamingCapability.id]: structuredNamingCapability as AgentCapability<unknown, unknown>,
  [removeBgCapability.id]: removeBgCapability as AgentCapability<unknown, unknown>,
  [webResearchCapability.id]: webResearchCapability as AgentCapability<unknown, unknown>,
  [writeLoreCapability.id]: writeLoreCapability as AgentCapability<unknown, unknown>,
  [imageTo3dCapability.id]: imageTo3dCapability as AgentCapability<unknown, unknown>,
};

export {
  structuredNamingCapability,
  removeBgCapability,
  webResearchCapability,
  writeLoreCapability,
  imageTo3dCapability,
};
