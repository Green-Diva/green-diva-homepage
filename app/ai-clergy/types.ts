import type { ClericSkill, ClericSkillLevel, ClericSkillKind } from "@/lib/clericTypes";

export type ClericStatus = "ONLINE" | "STANDBY" | "OFFLINE";
export type ClericProvider = "ANTHROPIC" | "OPENAI" | "INTERNAL" | "ECHO";
export type ClericMode = "MECHANICAL" | "AUTONOMOUS";

export interface ClericRow {
  id: string;
  serial: number | null;
  codename: string;
  nameEn: string;
  nameZh: string;
  classification: string | null;
  mode: ClericMode;
  status: ClericStatus;
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
  skills: ClericSkill[] | null;
  availableAp: number;
  enabled: boolean;
  provider: ClericProvider;
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

export type SkillLevel = ClericSkillLevel;

export interface SkillRow {
  id: string;
  level: number;
  icon: string;
  nameEn: string;
  nameZh: string;
  kind: ClericSkillKind;
  costAp: number;
  descriptionEn: string;
  descriptionZh: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface EquipRow {
  id: string;
  clericId: string;
  skillId: string;
  skill: SkillRow;
  unlocked: boolean;
  equippedAt: string;
}
