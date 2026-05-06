import { z } from "zod";

export const userCreateSchema = z.object({
  name: z.string().min(1).max(80),
  gender: z.enum(["female", "male", "other"]).optional().nullable(),
  level: z.number().int().min(1).max(999).default(1),
  token: z.string().min(8).max(128).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

export const userUpdateSchema = userCreateSchema.partial();

export const loginSchema = z.object({
  token: z.string().min(1),
});

export const profileUpdateSchema = z.object({
  bio: z.string().max(2000).optional().nullable(),
});

export const activityCreateSchema = z.object({
  content: z.string().min(1).max(280),
});

export const agentSkillSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  icon: z.string().min(1).max(64),
  nameEn: z.string().min(1).max(80),
  nameZh: z.string().min(1).max(80),
  kind: z.enum(["PASSIVE", "ACTIVE", "ULTIMATE"]),
  costAp: z.number().int().min(0).max(99),
  descriptionEn: z.string().max(2000),
  descriptionZh: z.string().max(2000),
  unlocked: z.boolean(),
});

const stat = z.number().int().min(0).max(100);

// Json blob — both pipeline and dispatcher configs are opaque at the API layer.
// Concrete shapes will be enforced by their respective editors.
const jsonObject = z.record(z.unknown());

export const pipelineConfigSchema = jsonObject.nullable();
export const dispatcherConfigSchema = jsonObject.nullable();

export const agentCreateSchema = z.object({
  codename: z.string().min(2).max(32).regex(/^[A-Z0-9-]+$/, "codename must be uppercase letters, digits, dashes"),
  codenameZh: z.string().max(32).optional().nullable(),
  nameEn: z.string().min(1).max(80),
  nameZh: z.string().min(1).max(80),
  mode: z.enum(["MECHANICAL", "AUTONOMOUS"]).optional(),
  status: z.enum(["ONLINE", "STANDBY", "OFFLINE"]).optional(),
  // Avatar required: accepts either a full URL or an absolute path served
  // from /public (uploads land at /images/agent-control/avatars/...).
  avatarUrl: z
    .string()
    .min(1)
    .refine(
      (s) => /^https?:\/\//.test(s) || s.startsWith("/"),
      { message: "must be a URL or absolute path" },
    ),
  descriptionEn: z.string().max(4000).optional().nullable(),
  descriptionZh: z.string().max(4000).optional().nullable(),
  syncLevel: z.number().min(0).max(100).optional(),
  matrixLevel: z.number().int().min(1).max(99).optional(),
  // Derived stats — clients usually shouldn't write these directly,
  // but admin can override during testing.
  chaosLevel: stat.optional(),
  costTier: stat.optional(),
  activityLevel: stat.optional(),
  stabilityLevel: stat.optional(),
  pipelineConfig: pipelineConfigSchema.optional(),
  dispatcherConfig: dispatcherConfigSchema.optional(),
  skills: z.array(agentSkillSchema).max(12).optional().nullable(),
  availableAp: z.number().int().min(0).max(999).optional(),
});

// Update schema relaxes avatarUrl back to optional — we don't want
// every PATCH to require re-sending the avatar.
export const agentUpdateSchema = agentCreateSchema.partial();

export const agentInvokeSchema = z.object({
  input: z.unknown(),
});

export const agentPipelineSchema = z.object({
  config: jsonObject.nullable(),
});

export const agentDispatcherSchema = z.object({
  config: jsonObject.nullable(),
});

export type AgentCreateInput = z.infer<typeof agentCreateSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const skillCreateSchema = z.object({
  level: z.number().int().min(1).max(6),
  icon: z.string().min(1).max(64),
  nameEn: z.string().min(1).max(80),
  nameZh: z.string().min(1).max(80),
  kind: z.enum(["PASSIVE", "ACTIVE", "ULTIMATE"]),
  costAp: z.number().int().min(0).max(99),
  descriptionEn: z.string().max(2000),
  descriptionZh: z.string().max(2000),
});
export const skillUpdateSchema = skillCreateSchema.partial();

export const agentSkillEquipSchema = z.object({
  skillId: z.string().cuid(),
  unlocked: z.boolean().optional().default(false),
  // 0..5 — the spine/brain slot. Omit or null to leave unslotted.
  slotIndex: z.number().int().min(0).max(5).nullable().optional(),
});

export const agentSkillUnlockSchema = z.object({
  unlocked: z.boolean().optional(),
  slotIndex: z.number().int().min(0).max(5).nullable().optional(),
});

export type SkillCreateInput = z.infer<typeof skillCreateSchema>;
export type SkillUpdateInput = z.infer<typeof skillUpdateSchema>;
