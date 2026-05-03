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

export const agentCreateSchema = z.object({
  codename: z.string().min(2).max(32).regex(/^[A-Z0-9-]+$/, "codename must be uppercase letters, digits, dashes"),
  nameEn: z.string().min(1).max(80),
  nameZh: z.string().min(1).max(80),
  classification: z.string().max(40).optional().nullable(),
  status: z.enum(["ONLINE", "STANDBY", "OFFLINE"]).optional(),
  avatarUrl: z.string().url().optional().nullable(),
  descriptionEn: z.string().max(4000).optional().nullable(),
  descriptionZh: z.string().max(4000).optional().nullable(),
  syncLevel: z.number().min(0).max(100).optional(),
  matrixLevel: z.number().int().min(1).max(99).optional(),
  quickness: stat.optional(),
  intelligence: stat.optional(),
  neuralLink: stat.optional(),
  bioSync: stat.optional(),
  logic: stat.optional(),
  compassion: stat.optional(),
  skills: z.array(agentSkillSchema).max(12).optional().nullable(),
  availableAp: z.number().int().min(0).max(999).optional(),
  enabled: z.boolean().optional(),
  provider: z.enum(["ANTHROPIC", "OPENAI", "INTERNAL", "ECHO"]).optional(),
  model: z.string().max(80).optional().nullable(),
  systemPrompt: z.string().max(8000).optional().nullable(),
  internalHandler: z.string().max(80).optional().nullable(),
  inputSchemaJson: z.string().max(8000).optional().nullable(),
  outputSchemaJson: z.string().max(8000).optional().nullable(),
  maxTokens: z.number().int().min(1).max(32000).optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  rateLimitPerMin: z.number().int().min(1).max(600).optional().nullable(),
});

export const agentUpdateSchema = agentCreateSchema.partial();

export const agentInvokeSchema = z.object({
  input: z.unknown(),
});

export type AgentCreateInput = z.infer<typeof agentCreateSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
