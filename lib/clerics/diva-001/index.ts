import "server-only";
import type { ClericCapability } from "../types";
import { structuredNamingCapability } from "./structured-naming";
import { removeBgCapability } from "./remove-bg";
import { webResearchCapability } from "./web-research";
import { writeLoreCapability } from "./write-lore";
import { imageTo3dCapability } from "./image-to-3d";

export const DIVA_001_CAPABILITIES: Record<string, ClericCapability<unknown, unknown>> = {
  [structuredNamingCapability.id]: structuredNamingCapability as ClericCapability<unknown, unknown>,
  [removeBgCapability.id]: removeBgCapability as ClericCapability<unknown, unknown>,
  [webResearchCapability.id]: webResearchCapability as ClericCapability<unknown, unknown>,
  [writeLoreCapability.id]: writeLoreCapability as ClericCapability<unknown, unknown>,
  [imageTo3dCapability.id]: imageTo3dCapability as ClericCapability<unknown, unknown>,
};

export {
  structuredNamingCapability,
  removeBgCapability,
  webResearchCapability,
  writeLoreCapability,
  imageTo3dCapability,
};
