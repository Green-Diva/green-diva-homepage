import type {
  AgentSkill,
  AgentSkillLevel,
  AgentSkillKind,
  PipelineConfig,
  DispatcherConfig,
} from "@/lib/agentTypes";

export type AgentStatus = "ONLINE" | "STANDBY" | "OFFLINE";
export type AgentProvider = "ANTHROPIC" | "OPENAI" | "INTERNAL" | "ECHO";
export type AgentMode = "MECHANICAL" | "AUTONOMOUS";

export interface AgentRow {
  id: string;
  serial: number | null;
  codename: string;
  nameEn: string;
  nameZh: string;
  classification: string | null;
  mode: AgentMode;
  status: AgentStatus;
  avatarUrl: string;
  descriptionEn: string | null;
  descriptionZh: string | null;
  syncLevel: number;
  matrixLevel: number;
  chaosLevel: number;
  costTier: number;
  activityLevel: number;
  stabilityLevel: number;
  pipelineConfig: PipelineConfig | null;
  dispatcherConfig: DispatcherConfig | null;
  deployedAt: string | null;
  skills: AgentSkill[] | null;
  availableAp: number;
  enabled: boolean;
  provider: AgentProvider;
  model: string | null;
  systemPrompt: string | null;
  internalHandler: string | null;
  inputSchemaJson: string | null;
  outputSchemaJson: string | null;
  maxTokens: number | null;
  temperature: number | null;
  rateLimitPerMin: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

export type SkillLevel = AgentSkillLevel;

export interface SkillRow {
  id: string;
  level: number;
  icon: string;
  nameEn: string;
  nameZh: string;
  kind: AgentSkillKind;
  costAp: number;
  descriptionEn: string;
  descriptionZh: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface EquipRow {
  id: string;
  agentId: string;
  skillId: string;
  skill: SkillRow;
  unlocked: boolean;
  slotIndex: number | null;
  equippedAt: string;
}
