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

export const AGENT_STAT_KEYS = [
  "quickness",
  "intelligence",
  "neuralLink",
  "bioSync",
  "logic",
  "compassion",
] as const;
export type AgentStatKey = (typeof AGENT_STAT_KEYS)[number];

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
