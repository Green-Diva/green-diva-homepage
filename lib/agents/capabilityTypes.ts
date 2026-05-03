// Pure type definitions shared between server (capability impls + summary helper)
// and client (CapabilityList rendering). No "server-only" guard so client bundles
// can import these types without bundler errors.

export interface AgentCapabilityMeta {
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
  agentCodename: string;
  metadata: AgentCapabilityMeta;
  envOk: boolean;
  missingEnvVars: string[];
  stats: CapabilityStats;
};
