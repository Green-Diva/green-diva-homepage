// Pure type definitions shared between server (capability impls + summary helper)
// and client (CapabilityList rendering). No "server-only" guard so client bundles
// can import these types without bundler errors.

/**
 * Skill autonomy level (orthogonal to cleric mode).
 * 0 = DETERMINISTIC: pure code / third-party API, no LLM decision.
 * 1 = ASSISTED: single LLM call (augmented LLM with tools / RAG).
 * 2 = ITERATIVE: LLM + self-evaluator loop (evaluator-optimizer).
 * 3 = ORCHESTRATED: master LLM dispatches to multiple worker capabilities.
 */
export type ClericCapabilityAutonomy = 0 | 1 | 2 | 3;

export interface ClericCapabilityMeta {
  /** Material Symbols Outlined identifier. */
  iconKey: string;
  nameEn: string;
  nameZh: string;
  descriptionEn: string;
  descriptionZh: string;
  /** Human label for the underlying service (e.g. "anthropic", "remove.bg", "meshy"). */
  provider: string;
  /** Env vars the capability needs to actually run; empty list = always available. */
  requiredEnvVars: string[];
  /** Autonomy level of this skill's internal implementation. */
  autonomyLevel: ClericCapabilityAutonomy;
}

export type CapabilityStats = {
  total: number;
  successful: number;
  failed: number;
  avgLatencyMs: number | null;
  last:
    | {
        ok: boolean;
        latencyMs: number | null;
        createdAt: string;
      }
    | null;
};

export type CapabilitySummary = {
  id: string;
  clericCodename: string;
  metadata: ClericCapabilityMeta;
  envOk: boolean;
  missingEnvVars: string[];
  stats: CapabilityStats;
};
