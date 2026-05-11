import { z } from "zod";
import { parseTemplate } from "@/lib/agent-service/template";

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
  kind: z.enum(["HTTP_API", "LLM_PROMPT", "MCP_SERVER"]),
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
  // Slot index 0-5 — matches AgentSkillEquip.slotIndex DB column. Was named
  // `equipSlot` pre-2026-05-11; migrate-rename-equipslot.ts rewrote existing
  // pipelineConfig JSON rows to the new name. New code should always emit
  // `slotIndex`.
  slotIndex: z.number().int().min(0).max(5),
  inputMapping: z.object({
    from: z.string().regex(INPUT_FROM_RE, 'must be "agent.input" or "<stepId>.output"'),
  }),
});

// — — DAG (v2) schemas — —
//
// v2 generalizes the linear v1 pipeline into a DAG with conditional branching
// so a single agent can fan out to "2D path" vs "3D path" etc. The runtime
// internally upconverts v1 → v2 (a linear chain of skill nodes) so all
// execution lives in one codepath. Cycle / branch-label / forward-ref
// validation lives in the runtime, not here, because they require the
// materialized graph.

// Source ref grammar:
//   agent.input                   → whole agent invocation input
//   agent.input.<a>.<b>           → drill into the input object
//   <nodeId>.output               → that node's output
//   <nodeId>.output.<a>.<b>       → drill into the output object
// The dot-path tail is optional; runtime walks it via the same logic as
// branch case `path` evaluation.
const SOURCE_REF_RE = /^(agent\.input|[a-zA-Z0-9_-]+\.output)(\.[a-zA-Z0-9_]+)*$/;
const sourceRefString = z
  .string()
  .regex(SOURCE_REF_RE, 'must be "agent.input[.path]" or "<nodeId>.output[.path]"');
const sourceRef = z.union([
  sourceRefString,
  z.object({ merge: z.record(sourceRefString) }),
]);

const branchCaseSchema = z.object({
  // Dot-path into the input object. Empty string = root (i.e., compare the
  // input itself). Useful when the upstream skill returns a primitive.
  path: z.string().max(120),
  op: z.enum(["eq", "ne", "in", "exists"]),
  value: z.unknown().optional(),
  // Must match the `when` field of one of this branch's outgoing edges.
  label: z.string().min(1).max(64),
});

// Editor-only metadata. Stored on the config so the canvas redraws in the
// same layout next session. The runtime ignores `position`.
const positionSchema = z.object({ x: z.number(), y: z.number() }).optional();

const dagSkillNodeSchema = z.object({
  id: z.string().min(1).max(64).regex(STEP_ID_RE, "node id must match [a-zA-Z0-9_-]+"),
  type: z.literal("skill"),
  // 0-5 — matches AgentSkillEquip.slotIndex DB column. Was `equipSlot`
  // pre-2026-05-11; migrate-rename-equipslot.ts handles the JSON rewrite.
  slotIndex: z.number().int().min(0).max(5),
  inputFrom: sourceRef,
  position: positionSchema,
});

const dagBranchNodeSchema = z.object({
  id: z.string().min(1).max(64).regex(STEP_ID_RE, "node id must match [a-zA-Z0-9_-]+"),
  type: z.literal("branch"),
  inputFrom: sourceRef,
  cases: z.array(branchCaseSchema).min(1).max(10),
  // Edge label to follow when no case matches. If unset, "no match" = abort.
  defaultLabel: z.string().min(1).max(64).optional(),
  position: positionSchema,
});

const dagEdgeSchema = z.object({
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  // Required iff source node is a branch — must match a case label or defaultLabel.
  when: z.string().min(1).max(64).optional(),
});

// Phase 8 — loop node. Body is a self-contained sub-DAG (own nodes +
// edges) so the outer topology stays acyclic. Each iteration runs the
// body with its `inputFrom` resolved value as the iteration state;
// subsequent iterations feed the prior iteration's leaf output back as
// the next iteration's state. Exit on the first matching exitWhen case
// OR on hitting maxIterations.
//
// Recursive shape via z.lazy() — body.nodes can itself contain loop
// nodes. Nesting depth capped at runtime (not schema) to keep cost +
// stack bounded.
//
// The lazy is anchored on the BODY object (not the union) because
// z.discriminatedUnion requires concrete ZodObject options. Trick:
// dagLoopNodeSchema's `body` is the only recursive seam; once parsing
// reaches it, lazy forwards back to the same dagNodeSchema discriminator.
const dagLoopNodeSchema: z.ZodTypeAny = z.object({
  id: z.string().min(1).max(64).regex(STEP_ID_RE, "node id must match [a-zA-Z0-9_-]+"),
  type: z.literal("loop"),
  inputFrom: sourceRef,
  // Hard cap on iterations — runtime burns LLM tokens / API quota per
  // pass, so the upper bound matters for cost predictability. Admin
  // can request a wider cap if a use case warrants more.
  maxIterations: z.number().int().min(1).max(10),
  // Each case: when this matches the iteration's leaf output (drilled
  // by `path`), the loop exits. Empty / unset = run to maxIterations.
  // `label` field is required by branchCaseSchema but unused here (no
  // labeled exit edges) — admins set any non-empty string.
  exitWhen: z.array(branchCaseSchema).max(10).optional(),
  // Recursive seam. body.nodes can itself contain loop nodes; the lazy
  // breaks the cyclic type reference at compile time.
  body: z.lazy(() =>
    z.object({
      nodes: z.array(dagNodeSchema).min(1).max(20),
      edges: z.array(dagEdgeSchema).max(40),
    }),
  ),
  aggregate: z.enum(["last", "concat-array"]).optional(),
  position: positionSchema,
});

// forEach node — like loop, but runs body once per item in the
// inputFrom-resolved array. Each iteration's body input is
// `{ item, index, total }` (the body reads `agent.input.item` etc.).
// Aggregate semantics same as loop: "last" returns the final iteration's
// leaf output, "concat-array" concatenates all leaf outputs (default for
// forEach). Use this when smartImagePicker-style "for each candidate URL,
// download + vision-filter, then merge" is the natural shape.
const dagForEachNodeSchema: z.ZodTypeAny = z.object({
  id: z.string().min(1).max(64).regex(STEP_ID_RE, "node id must match [a-zA-Z0-9_-]+"),
  type: z.literal("forEach"),
  inputFrom: sourceRef,
  // Cap items per iteration to keep cost + runtime bounded. SerpAPI
  // 10-image batches sit comfortably under 50; bumping requires PR.
  maxItems: z.number().int().min(1).max(50),
  body: z.lazy(() =>
    z.object({
      nodes: z.array(dagNodeSchema).min(1).max(20),
      edges: z.array(dagEdgeSchema).max(40),
    }),
  ),
  aggregate: z.enum(["last", "concat-array"]).optional(),
  position: positionSchema,
});

// transform node — pure data shaping, no external calls. Body is a
// JSONata expression evaluated against the inputFrom-resolved value.
// Use this for zip / map / filter / reduce on arrays + objects without
// adding an INTERNAL helper (e.g. "apply vision verdicts onto candidate
// list" in the smart-image-pick decomposition). JSONata is sandboxed by
// design — no FS / network / eval; just JSON-in JSON-out.
const dagTransformNodeSchema = z.object({
  id: z.string().min(1).max(64).regex(STEP_ID_RE, "node id must match [a-zA-Z0-9_-]+"),
  type: z.literal("transform"),
  inputFrom: sourceRef,
  // JSONata source. Capped — admin can store ~half a screen of expression
  // before having to refactor into multiple transform nodes.
  expression: z.string().min(1).max(4_000),
  position: positionSchema,
});

const dagNodeSchema = z.discriminatedUnion("type", [
  dagSkillNodeSchema,
  dagBranchNodeSchema,
  dagLoopNodeSchema as unknown as typeof dagSkillNodeSchema,
  dagForEachNodeSchema as unknown as typeof dagSkillNodeSchema,
  dagTransformNodeSchema as unknown as typeof dagSkillNodeSchema,
]);

export const pipelineConfigV2Schema = z.object({
  version: z.literal(2),
  nodes: z.array(dagNodeSchema).min(1).max(40),
  edges: z.array(dagEdgeSchema).max(80),
});

// Strict shape backing Backbone (MECHANICAL) execution. Accepts either v1
// (legacy linear) or v2 (DAG). Steps/nodes capped to bound runtime.
export const pipelineConfigSchema = z
  .union([
    z.object({
      version: z.literal(1),
      steps: z.array(pipelineStepSchema).min(1).max(20),
    }),
    pipelineConfigV2Schema,
  ])
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

// Skill.kind values — the runtime routing field. Was named handlerKindSchema
// pre-2026-05-10. The export name is kept for back-compat across importing
// modules; alias `skillKindSchema` is preferred for new code. INTERNAL was
// removed 2026-05-11 (picker-forge decomposition retired the last user).
export const skillKindSchema = z.enum(["HTTP_API", "LLM_PROMPT", "MCP_SERVER"]);
export const handlerKindSchema = skillKindSchema;

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

// Template parse-once validators — apply to every `{{path}}`-bearing
// field in handlerConfig at save-time. Mirrors the JSONata parse-once
// check on transform nodes in lib/skills/runtime/backbone.ts: malformed
// templates surface in the SkillEditor red-text instead of blowing up
// mid-AgentJob. Runtime `applyTemplate` stays graceful as defense in
// depth.
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

type LeafPath = (string | number)[];

function collectTemplateStrings(
  value: unknown,
  path: LeafPath,
): Array<{ path: LeafPath; value: string }> {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => collectTemplateStrings(item, [...path, i]));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([k, v]) =>
      collectTemplateStrings(v, [...path, k]),
    );
  }
  return [];
}

function refineTemplateString(
  ctx: z.RefinementCtx,
  value: string,
  path: LeafPath,
): void {
  const parsed = parseTemplate(value);
  if (parsed.ok) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message: `template parse failed at offset ${parsed.offset}: ${parsed.error}`,
  });
}

function refineHttpApiHandlerConfig(
  cfg: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  if (typeof cfg.url === "string") {
    refineTemplateString(ctx, cfg.url, ["handlerConfig", "url"]);
  }
  for (const key of ["queryTemplate", "bodyTemplate", "headers", "responseTransform"] as const) {
    const sub = cfg[key];
    if (sub == null) continue;
    if (typeof sub === "string") {
      refineTemplateString(ctx, sub, ["handlerConfig", key]);
      continue;
    }
    for (const leaf of collectTemplateStrings(sub, ["handlerConfig", key])) {
      refineTemplateString(ctx, leaf.value, leaf.path);
    }
  }
  const polling = cfg.polling;
  if (isPlainObject(polling)) {
    if (typeof polling.url === "string") {
      refineTemplateString(ctx, polling.url, ["handlerConfig", "polling", "url"]);
    }
    if (isPlainObject(polling.headers)) {
      for (const leaf of collectTemplateStrings(polling.headers, ["handlerConfig", "polling", "headers"])) {
        refineTemplateString(ctx, leaf.value, leaf.path);
      }
    }
  }
}

function refineLlmPromptHandlerConfig(
  cfg: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  for (const key of ["systemPrompt", "userTemplate"] as const) {
    if (typeof cfg[key] === "string") {
      refineTemplateString(ctx, cfg[key] as string, ["handlerConfig", key]);
    }
  }
}

function refineSkillHandlerTemplates(
  skill: { kind?: string | undefined; handlerConfig?: Record<string, unknown> | undefined },
  ctx: z.RefinementCtx,
): void {
  if (!skill.handlerConfig || !skill.kind) return;
  if (skill.kind === "HTTP_API") refineHttpApiHandlerConfig(skill.handlerConfig, ctx);
  else if (skill.kind === "LLM_PROMPT") refineLlmPromptHandlerConfig(skill.handlerConfig, ctx);
}

// Permissive JSON Schema validator — accept any JSON object (or null).
// Real JSON Schema spec compliance lives at runtime in lib/skills/invoke.ts.
const jsonSchemaSchema = z.record(z.unknown()).nullable().optional();

// Stable machine slug — LLM tool name + future admin URL. Format mirrors
// kebab-case so it's both URL-safe and a legal Anthropic/OpenAI tool name
// (both providers accept [a-zA-Z0-9_-]{1,64}).
const skillSlugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
export const skillSlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(skillSlugRegex, "slug must be lowercase letters, digits, single dashes (no leading/trailing dash)");

const skillCreateBaseSchema = z.object({
  slug: skillSlugSchema.optional(),
  // level/costAp kept for back-compat — new UI hides them. Optional so
  // POST bodies that omit these fall back to schema defaults.
  level: z.number().int().min(1).max(6).optional(),
  icon: z.string().min(1).max(64),
  nameEn: z.string().min(1).max(80),
  nameZh: z.string().min(1).max(80),
  costAp: z.number().int().min(0).max(99).optional(),
  descriptionEn: z.string().max(2000),
  descriptionZh: z.string().max(2000),
  // Runtime routing — see prisma/schema.prisma SkillKind enum.
  kind: skillKindSchema.optional(),
  handlerConfig: handlerConfigSchema.optional(),
  inputSchema: jsonSchemaSchema,
  outputSchema: jsonSchemaSchema,
  // Admin toggle. Default OFFLINE for newly-created skills until admin
  // tests the handler config, then flips to ONLINE.
  status: z.enum(["ONLINE", "OFFLINE"]).optional(),
});

export const skillCreateSchema = skillCreateBaseSchema.superRefine(refineSkillHandlerTemplates);
export const skillUpdateSchema = skillCreateBaseSchema.partial().superRefine(refineSkillHandlerTemplates);

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

// — — SceneBinding (agent-service Phase 0c) — —
//
// PATCH body for /api/scene-bindings/[sceneKey]. Used as upsert: if the
// row doesn't yet exist for this sceneKey (e.g. a freshly-registered
// scene without a default seed), the endpoint creates it. Admin always
// supplies the full set of fields — partial PATCH semantics would force
// us to query-then-merge inside the endpoint, complicating template
// validation.
//
// inputMap is intentionally a permissive `unknown` — applyTemplate is
// happy with any nested shape. The runtime layer (lib/agent-service)
// is what fails dispatch if the produced AgentJob.input doesn't match
// the bound agent's inputSchema.
//
// 2026-05-11: outputMap field retired. Bindings are pure routing now —
// scene.outputSchema is the contract, agents self-shape via tail
// transforms.
export const sceneBindingUpdateSchema = z
  .object({
    agentId: z.string().cuid(),
    inputMap: z.unknown(),
    enabled: z.boolean().default(true),
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((binding, ctx) => {
    // Parse-once every `{{path}}` template in inputMap at save-time.
    // Same pattern as Skill.handlerConfig refine — admin sees red text
    // in SceneBindingEditor instead of an empty-string interpolation
    // surprising them at dispatch.
    if (binding.inputMap == null) return;
    for (const leaf of collectTemplateStrings(binding.inputMap, ["inputMap"])) {
      refineTemplateString(ctx, leaf.value, leaf.path);
    }
  });
export type SceneBindingUpdateInput = z.infer<typeof sceneBindingUpdateSchema>;

export const sceneSampleRunSchema = z.object({
  ctx: z.unknown(),
});

// — — Agent Export / Import (Phase 4) — —
//
// JSON envelope for portable agent definitions. An export is everything
// needed to recreate the agent on a different deployment: meta + backbone
// DAG + every equipped skill's full definition + slot index. NOT included:
// runtime state (deployedAt, createdAt, ids), AgentJob history,
// SceneBindings (those are deployment-specific and admin re-binds after
// import).
//
// Versioned via the literal `format` discriminator so future schema
// changes can branch on it without breaking older exports.
const exportSkillSchema = z.object({
  slug: z.string().min(1).max(64),
  level: z.number().int().min(1).max(6),
  icon: z.string().min(1).max(64),
  nameEn: z.string().min(1).max(80),
  nameZh: z.string().min(1).max(80),
  // Pre-2026-05-10 envelopes carried a separate decorative `kind`
  // (PASSIVE/ACTIVE/ULTIMATE) alongside `handlerKind`. Both are accepted on
  // import (decorative kind is dropped on the way in); current exports only
  // emit the runtime `kind` (HTTP_API/LLM_PROMPT/...). Pre-2026-05-11
  // exports may carry `kind: "INTERNAL"` — accepted here for back-compat;
  // the import endpoint translates it to MCP_SERVER (INTERNAL was retired
  // when picker-forge decomposed the last user).
  kind: z.enum(["HTTP_API", "LLM_PROMPT", "MCP_SERVER", "INTERNAL"]).optional(),
  handlerKind: z.enum(["HTTP_API", "LLM_PROMPT", "MCP_SERVER", "INTERNAL"]).optional(),
  legacyKind: z.enum(["PASSIVE", "ACTIVE", "ULTIMATE"]).optional(),
  costAp: z.number().int().min(0).max(99),
  descriptionEn: z.string().max(2000),
  descriptionZh: z.string().max(2000),
  status: z.enum(["ONLINE", "OFFLINE"]),
  handlerConfig: handlerConfigSchema,
  inputSchema: jsonSchemaSchema,
  outputSchema: jsonSchemaSchema,
  // Equipment metadata (carried alongside the skill so import re-creates
  // both atomically).
  slotIndex: z.number().int().min(0).max(5).nullable(),
  unlocked: z.boolean(),
});

const exportAgentMetaSchema = z.object({
  codename: z.string().min(1).max(64),
  codenameZh: z.string().max(64).nullable().optional(),
  nameEn: z.string().min(1).max(80),
  nameZh: z.string().min(1).max(80),
  mode: z.enum(["MECHANICAL", "AUTONOMOUS"]),
  avatarUrl: z.string().min(1).max(500),
  descriptionEn: z.string().max(2000).nullable().optional(),
  descriptionZh: z.string().max(2000).nullable().optional(),
  capabilities: z.array(z.string().min(1).max(64)).max(40).default([]),
  // pipelineConfig / dispatcherConfig validated on import as plain JSON;
  // re-validating against pipelineConfigSchema/dispatcherConfigSchema
  // happens via the existing /api/agents/[id]/pipeline route flow if
  // admin edits after import. Strict re-validation here would reject
  // valid-but-not-yet-shape-checked JSON and turn import into a paper
  // chase; we trust the export source.
  pipelineConfig: z.unknown().nullable().optional(),
  dispatcherConfig: z.unknown().nullable().optional(),
});

export const agentExportSchema = z.object({
  format: z.literal("green-diva-agent-export-v1"),
  exportedAt: z.string().optional(),
  exportedBy: z.string().optional(),
  agent: exportAgentMetaSchema,
  skills: z.array(exportSkillSchema).max(20),
});
export type AgentExport = z.infer<typeof agentExportSchema>;

// Import-side options. `conflictPolicy` controls what happens when an
// agent codename or skill slug collides with existing rows.
//   - rejectOnAgentConflict (default true): refuse if codename exists.
//     Admin then explicitly retries with newCodename to rename.
//   - skillConflict: "reuse" (default) keeps the existing skill (admin
//     can compare configs in SkillLibrary later); "rename" auto-suffixes
//     the imported skill's slug and creates a fresh row.
export const agentImportOptionsSchema = z.object({
  payload: agentExportSchema,
  newCodename: z.string().min(1).max(64).optional(),
  rejectOnAgentConflict: z.boolean().optional().default(true),
  skillConflict: z.enum(["reuse", "rename"]).optional().default("reuse"),
});
export type AgentImportInput = z.infer<typeof agentImportOptionsSchema>;

// — — Internal save-asset endpoint (agent-service Phase 2.3) — —
//
// Body for POST /api/internal/save-asset. Used by HTTP_API skills that
// need to persist a downloaded blob (Meshy GLB, fal cutout PNG, …) into
// `private/relics/<slug>/derived/`. Restricted to relic-* slug formats
// + a small allowlist of `kind` values to keep filenames predictable.
//
// `ext` is parsed from contentType when omitted, falling back to ".bin".
// We never trust client-side filenames (path-traversal risk).
// Accepts both real Relic slugs ("vault-001-abc") and draft workspace
// slugs ("_drafts/<cuid>"). The slash is the only special char allowed,
// and only as the prefix separator — saved files still land under the
// same private/relics/<slug>/derived/ tree because path.join handles it
// correctly. Path traversal is blocked downstream by the path.resolve()
// boundary check in the route handler.
const RELIC_SLUG_RE = /^(_drafts\/)?[a-zA-Z0-9_-]{1,80}$/;
const KIND_RE = /^[a-z0-9-]{1,32}$/;
const EXT_RE = /^\.[a-z0-9]{1,8}$/;

export const internalSaveAssetSchema = z.object({
  relicSlug: z.string().regex(RELIC_SLUG_RE, "relicSlug must match [a-zA-Z0-9_-]{1,80}"),
  kind: z.string().regex(KIND_RE, 'kind must match [a-z0-9-]{1,32} (e.g. "enhanced", "model")'),
  base64: z.string().min(1).max(120_000_000), // ~90MB raw — base64 swells ~33%
  contentType: z.string().max(120).optional(),
  ext: z.string().regex(EXT_RE, 'ext must look like ".png" / ".glb"').optional(),
});
export type InternalSaveAssetInput = z.infer<typeof internalSaveAssetSchema>;
