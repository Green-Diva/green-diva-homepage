import type { AgentSkill, AgentSkillLevel } from "@/lib/agentTypes";

export type AgentStatus = "ONLINE" | "STANDBY" | "OFFLINE";
export type AgentProvider = "ANTHROPIC" | "OPENAI" | "INTERNAL" | "ECHO";

export interface AgentRow {
  id: string;
  serial: number | null;
  codename: string;
  nameEn: string;
  nameZh: string;
  classification: string | null;
  status: AgentStatus;
  avatarUrl: string | null;
  descriptionEn: string | null;
  descriptionZh: string | null;
  syncLevel: number;
  matrixLevel: number;
  quickness: number;
  intelligence: number;
  neuralLink: number;
  bioSync: number;
  logic: number;
  compassion: number;
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
