export type ClericSkillKind = "PASSIVE" | "ACTIVE" | "ULTIMATE";

export type ClericSkillLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface ClericSkill {
  level: ClericSkillLevel;
  icon: string;
  nameEn: string;
  nameZh: string;
  kind: ClericSkillKind;
  costAp: number;
  descriptionEn: string;
  descriptionZh: string;
  unlocked: boolean;
}

export const CLERIC_STAT_KEYS = [
  "quickness",
  "intelligence",
  "neuralLink",
  "bioSync",
  "logic",
  "compassion",
] as const;
export type ClericStatKey = (typeof CLERIC_STAT_KEYS)[number];

export type ClericInvokeOk = {
  ok: true;
  output: unknown;
  latencyMs: number;
  invocationId: string;
};

export type ClericInvokeErr = {
  ok: false;
  error: string;
  latencyMs: number;
  invocationId: string | null;
};

export type ClericInvokeResult = ClericInvokeOk | ClericInvokeErr;

export type AgentInvokeSource = "ui-console" | "internal" | "http";
