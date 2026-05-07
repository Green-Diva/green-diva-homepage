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

const STEP_ID_RE = /^[a-zA-Z0-9_-]+$/;
const INPUT_FROM_RE = /^(agent\.input|[a-zA-Z0-9_-]+\.output)$/;

export const pipelineStepSchema = z.object({
  id: z.string().min(1).max(64).regex(STEP_ID_RE, "step id must match [a-zA-Z0-9_-]+"),
  equipSlot: z.number().int().min(0).max(5),
  inputMapping: z.object({
    from: z.string().regex(INPUT_FROM_RE, 'must be "agent.input" or "<stepId>.output"'),
  }),
});

// Strict shape backing Backbone (MECHANICAL) execution.
//   - version pinned to 1; bumping it is an explicit migration event
//   - steps capped at 20 to avoid pathological pipelines blocking on retries
export const pipelineConfigSchema = z
  .object({
    version: z.literal(1),
    steps: z.array(pipelineStepSchema).min(1).max(20),
  })
  .nullable();

// Strict shape backing Orchestrator (AUTONOMOUS) execution.
//   - version pinned to 1; bumping it is an explicit migration event
//   - maxIterations capped at 50 to bound LLM spend
export const dispatcherConfigSchema = z
  .object({
    version: z.literal(1),
    provider: z.enum(["anthropic", "openai"]),
    model: z.string().min(1).max(100),
    systemPrompt: z.string().max(20000).optional(),
    maxIterations: z.number().int().min(1).max(50).optional(),
    temperature: z.number().min(0).max(2).optional(),
    authEnv: z.string().max(64).optional(),
  })
  .nullable();

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

// PUT /api/agents/[id]/pipeline + /dispatcher body shapes — both enforce
// the structured config so strict validation lives at the API boundary,
// not just in the editor / runtime.
export const agentPipelineSchema = z.object({
  config: pipelineConfigSchema,
});

export const agentDispatcherSchema = z.object({
  config: dispatcherConfigSchema,
});

export type AgentCreateInput = z.infer<typeof agentCreateSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const handlerKindSchema = z.enum(["HTTP_API", "LLM_PROMPT", "MCP_SERVER", "INTERNAL"]);

// Reject handlerConfig keys that look like plaintext credentials.
// Forces "secrets via env only" — admin should pass { authEnv: "MESHY_API_KEY" },
// never { apiKey: "sk-..." }. The check is a heuristic, not bulletproof —
// belt-and-suspenders alongside reviewer vigilance and audit logging.
const PLAINTEXT_SECRET_RE = /^(apiKey|api_key|secret|token|password|bearer|access_key|accessKey)$/i;
export const handlerConfigSchema = z
  .record(z.unknown())
  .refine(
    (cfg) => !Object.keys(cfg).some((k) => PLAINTEXT_SECRET_RE.test(k)),
    {
      message:
        'handlerConfig must not contain plaintext credentials (apiKey/secret/token/password/bearer/access_key). Use { authEnv: "MY_ENV_NAME" } instead.',
    },
  );

// Permissive JSON Schema validator — accept any JSON object (or null).
// Real JSON Schema spec compliance lives at runtime in lib/skills/invoke.ts.
const jsonSchemaSchema = z.record(z.unknown()).nullable().optional();

export const skillCreateSchema = z.object({
  level: z.number().int().min(1).max(6),
  icon: z.string().min(1).max(64),
  nameEn: z.string().min(1).max(80),
  nameZh: z.string().min(1).max(80),
  kind: z.enum(["PASSIVE", "ACTIVE", "ULTIMATE"]),
  costAp: z.number().int().min(0).max(99),
  descriptionEn: z.string().max(2000),
  descriptionZh: z.string().max(2000),
  // Runtime routing — see prisma/schema.prisma HandlerKind enum.
  handlerKind: handlerKindSchema.optional(),
  handlerConfig: handlerConfigSchema.optional(),
  inputSchema: jsonSchemaSchema,
  outputSchema: jsonSchemaSchema,
  // Admin toggle. Default OFFLINE for newly-created skills until admin
  // tests the handler config, then flips to ONLINE.
  status: z.enum(["ONLINE", "OFFLINE"]).optional(),
});
export const skillUpdateSchema = skillCreateSchema.partial();

export const skillTestInvokeSchema = z.object({
  input: z.unknown(),
});

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
