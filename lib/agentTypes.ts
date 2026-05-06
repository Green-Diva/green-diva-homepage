export type AgentSkillKind = "PASSIVE" | "ACTIVE" | "ULTIMATE";

export type AgentSkillLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface AgentSkill {
  level: AgentSkillLevel;
  icon: string;
  nameEn: string;
  nameZh: string;
  kind: AgentSkillKind;
  costAp: number;
  descriptionEn: string;
  descriptionZh: string;
  unlocked: boolean;
}

// Derived stats (0-100). Real algorithms ship later — see lib/agents/derived.ts (TODO).
//   chaos     → cross-mode skill mismatch ("cyberpsychosis" idea)
//   cost      → cumulative external API spend tier
//   activity  → invocation count over a rolling window
//   stability → success rate of recent invocations
export const AGENT_STAT_KEYS = [
  "chaosLevel",
  "costTier",
  "activityLevel",
  "stabilityLevel",
] as const;
export type AgentStatKey = (typeof AGENT_STAT_KEYS)[number];

// Central control slot payloads — both are opaque Json blobs at the data layer.
// `pipelineConfig` (machine) is a workflow definition; `dispatcherConfig`
// (agent) is an AI-orchestrator definition. Concrete shapes will be defined
// when each editor is implemented; for now we keep the type loose to avoid
// premature lock-in.
export interface PipelineConfig {
  version?: number;
  nodes?: unknown[];
  edges?: unknown[];
  params?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface DispatcherConfig {
  version?: number;
  strategy?: string;
  model?: string;
  systemPrompt?: string;
  params?: Record<string, unknown>;
  [k: string]: unknown;
}

export const SKILL_SLOT_COUNT = 6;
export type SkillSlotIndex = 0 | 1 | 2 | 3 | 4 | 5;

export type AgentInvokeOk = {
  ok: true;
  output: unknown;
  latencyMs: number;
  invocationId: string;
};

export type AgentInvokeErr = {
  ok: false;
  error: string;
  latencyMs: number;
  invocationId: string | null;
};

export type AgentInvokeResult = AgentInvokeOk | AgentInvokeErr;

export type AgentInvokeSource = "ui-console" | "internal" | "http";
