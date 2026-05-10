import type {
  AgentSkill,
  AgentSkillLevel,
  AgentSkillKind,
  PipelineConfig,
  DispatcherConfig,
} from "@/lib/agentTypes";

export type AgentStatus = "ONLINE" | "STANDBY" | "OFFLINE";
export type AgentMode = "MECHANICAL" | "AUTONOMOUS";

export interface AgentRow {
  id: string;
  serial: number | null;
  codename: string;
  codenameZh: string | null;
  nameEn: string;
  nameZh: string;
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
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

export type SkillLevel = AgentSkillLevel;

export type SkillStatus = "ONLINE" | "OFFLINE";

export type HandlerKind = "HTTP_API" | "LLM_PROMPT" | "MCP_SERVER" | "INTERNAL";

export interface SkillRow {
  id: string;
  slug: string | null;
  level: number;
  icon: string;
  nameEn: string;
  nameZh: string;
  kind: AgentSkillKind;
  status: SkillStatus;
  costAp: number;
  descriptionEn: string;
  descriptionZh: string;
  handlerKind: HandlerKind;
  handlerConfig: Record<string, unknown>;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
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

// Wire-shaped SceneBinding row for the /agent-control?tab=scenes view.
// Mirrors prisma.SceneBinding columns; dates serialized to ISO. agentId
// can be null after admin deletes the bound agent (FK is RESTRICT, so in
// practice this only happens if a binding row was created for a sceneKey
// before its scene was registered, but the type stays nullable for safety).
export interface SceneBindingRow {
  sceneKey: string;
  agentId: string;
  agentCodename: string | null;
  agentMode: AgentMode | null;
  agentDeployed: boolean;
  agentCapabilities: string[];
  inputMap: unknown;
  outputMap: unknown;
  enabled: boolean;
  notes: string | null;
  rolloutPct: number;
  fallbackAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Re-export the agent-service serialization shape so client components
// can stay agent-control-local for their imports.
export type {
  SerializableSceneDef,
  SchemaFieldHint,
} from "@/lib/agent-service";

// Compact agent reference for the scene-binding agent picker (no
// loadout / config blob bloat).
export interface AgentPickerOption {
  id: string;
  codename: string;
  nameEn: string;
  nameZh: string;
  mode: AgentMode;
  deployedAt: string | null;
  capabilities: string[];
}
