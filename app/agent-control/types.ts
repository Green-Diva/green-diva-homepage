import type {
  AgentSkill,
  AgentSkillLevel,
  AgentSkillKind,
  PipelineConfig,
  DispatcherConfig,
} from "@/lib/agentTypes";

// Public alias kept for callers that still import "HandlerKind" from this
// module — the underlying values are identical to AgentSkillKind after the
// 2026-05-10 collapse.
export type HandlerKind = AgentSkillKind;

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
  // Scene contracts this agent must satisfy. Server-derived from
  // SceneBinding rows joined with the registered scene definitions.
  // BackboneFlowEditor renders these as decorative BEGIN / END nodes
  // so admin sees "what comes in from the bound module / what must go
  // back out". Empty array = agent unbound (free invocation only).
  boundScenes: BoundSceneSummary[];
  // Draft-phase scene claims (non-exclusive). Multiple agents may declare
  // intent over the same sceneKey. Deploy converts these into SceneBinding
  // takeovers. Surfaced in AgentEditor's "目标 Scene" multi-select.
  intentSceneKeys: string[];
  skills: AgentSkill[] | null;
  availableAp: number;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

export type SkillLevel = AgentSkillLevel;

export type SkillStatus = "ONLINE" | "OFFLINE";

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
  enabled: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Re-export the agent-service serialization shape so client components
// can stay agent-control-local for their imports.
export type {
  SerializableSceneDef,
  SchemaFieldHint,
} from "@/lib/agent-service";

// Compact view of one scene this agent is bound to. Drives the
// decorative BEGIN / END nodes in BackboneFlowEditor — admin sees
// "module → ctx → agent.input" on the BEGIN side and "agent.leaf →
// scene contract" on the END side, even though neither is part of
// pipelineConfig. Server-derived in app/agent-control/page.tsx.
export interface BoundSceneSummary {
  sceneKey: string;
  module: string;
  invocation: "sync" | "async";
  label: { en: string; zh: string };
  // Caller's ctx → agent.input. Reuses scene.contextSchema's
  // describeZod() output so the field shapes line up with the existing
  // scene editor.
  contextFields: import("@/lib/agent-service").SchemaFieldHint[];
  // The contract this agent's leaf must satisfy.
  outputFields: import("@/lib/agent-service").SchemaFieldHint[];
  // "binding" → real SceneBinding row exists (production-routable).
  // "intent"  → draft-phase claim via Agent.intentSceneKeys only; no
  //             traffic flows until the agent is deployed and the binding
  //             is materialized. Rendered with a distinct style in
  //             BackboneFlowEditor's BEGIN/END nodes.
  via: "binding" | "intent";
}

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
