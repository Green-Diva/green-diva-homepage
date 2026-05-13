// Relic-module scenes. Imported as a side-effect from lib/scenes-init.ts
// so registerScene runs at process boot. Anything the relic module wants
// to outsource to the agent layer goes through one of these.
//
// Adding a new relic scene:
//   1. registerScene(...) below with full zod input/output schemas.
//   2. The migrate-scene-bindings script seeds a default binding to
//      RELIC-SCRIBE-001 so the scene is dispatchable on first deploy.
//   3. Whatever endpoint / pipeline step needs it imports
//      `dispatchScene` / `callScene` and references the key string.
// No commit needed for "swap which agent satisfies it" — admin does that
// in /agent-control?tab=scenes.

import "server-only";
import { z } from "zod";
import { registerScene, registerSceneAlias } from "@/lib/agent-service";

// — Shared structural primitives — ——————————————————————————————————
//
// Scene outputSchemas are the authoritative contract between agents and
// downstream consumers (pipeline steps / endpoints). They enforce
// STRUCTURE, not semantics — a transform node can still塑形 garbage into
// schema-conformant garbage. The strict regex/length bounds raise the
// floor by rejecting obvious mismatches (English in Chinese fields, etc.).
const cjkRequired = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/[一-鿿]/, "必须含至少一个汉字");
const englishStarting = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z]/, "必须英文打头");
// Material Symbols icon name — lowercase letters / digits / underscore.
const iconKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "必须是 Material Symbols 名（小写字母 / 数字 / 下划线）");
const RARITIES = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as const;

// — relic.generateDraftMetadata —
// Sync. Triggered from the draft pipeline's GENERATE_METADATA step
// (lib/relics/pipeline/steps/generateMetadata.ts).
//
// 2026-05-11: outputSchema tightened from z.unknown() to a structured
// `{ research: {...} }`. LORE-FORGE-001 must self-shape via a tail
// transform node; the previous outputMap-driven reshape is gone.
//
// 2026-05-11 (rename): key was "relic.draft-metadata" (noun) — renamed to
// verb-first "relic.generate-draft-metadata" to match the other 4 relic.*
// scenes. The old key resolves via registerSceneAlias below; drop the
// alias once existing SceneBinding.sceneKey rows have been migrated.
export const relicDraftMetadataScene = registerScene({
  key: "relic.generate-draft-metadata",
  module: "relic",
  label: { en: "Draft Metadata Generation", zh: "草稿元数据生成" },
  description: {
    en: "Run the relic scribe over a draft workspace to produce lore + metadata.",
    zh: "对草稿工作目录跑 relic scribe，生成圣记 + 元数据。",
  },
  contextSchema: z.object({
    // Workspace-relative slug. For drafts: "_drafts/<draftId>".
    // For legacy direct-to-Relic flows: relic.slug.
    workspaceSlug: z.string().min(1),
    // Pre-scanned workspace context — populated by runScribeForWorkspace
    // via scanWorkspace() before callScene. The Lore Forge DAG reads
    // these from agent.input directly.
    userBrief: z.string().optional().default(""),
    fileSummary: z.string().optional().default(""),
    imageAbsPaths: z.array(z.string()).optional().default([]),
    textExcerpts: z.string().optional().default(""),
  }),
  outputSchema: z
    .object({
      research: z.object({
        titleZh: cjkRequired(2, 40),
        titleEn: englishStarting(2, 80),
        subtitleZh: cjkRequired(2, 80),
        subtitleEn: englishStarting(2, 160),
        icon: iconKey,
        rarity: z.enum(RARITIES),
        decisionReason: z.string().max(500).optional(),
        useUserImage: z.boolean().optional(),
        networkImageQuery: z.string().max(200).optional(),
        loreEn: z.string().min(50).max(2000).optional(),
        loreZh: cjkRequired(50, 2000).optional(),
      }),
    })
    .passthrough(),
  invocation: "sync",
  // image-pick lives in a separate scene (relic.smart-image-pick) since
  // the Phase 8 picker decomposition. LORE-FORGE no longer claims it.
  requiredCapabilities: ["lore-writing", "metadata-derivation"],
  // ctx → agent.input. Injects mode discriminator (LORE-FORGE branches
  // on `input.mode` to pick draft vs regen DAG path) + renames
  // workspaceSlug to relicSlug (forge's internal vocabulary).
  prepareAgentInput: (ctx) => ({
    mode: "initial",
    relicSlug: ctx.workspaceSlug,
    userBrief: ctx.userBrief,
    fileSummary: ctx.fileSummary,
    imageAbsPaths: ctx.imageAbsPaths,
    textExcerpts: ctx.textExcerpts,
  }),
});

// Legacy alias — drop after SceneBinding.sceneKey rows have been migrated.
registerSceneAlias("relic.draft-metadata", "relic.generate-draft-metadata");

// — relic.smartImagePick —
// Sync. Triggered by runScribeForWorkspace AFTER relic.draft-metadata so
// the picker can use metadata-init's `useUserImage` / `networkImageQuery`
// decision. Returns the candidate set + recommended primary path.
//
// Pipeline-layer staging populates `userCandidates` + `referenceImageAbs`
// via stageUserCandidates() before callScene; the picker agent never
// touches the FS for user images.
export const relicSmartImagePickScene = registerScene({
  key: "relic.smart-image-pick",
  module: "relic",
  label: { en: "Smart Image Pick", zh: "智能选图" },
  description: {
    en: "Pick recommended primary image for a relic — user images plus optional SerpAPI search with two-round vision verification.",
    zh: "为 relic 挑选推荐主图——用户图叠加可选 SerpAPI 搜索，含两轮视觉比对。",
  },
  contextSchema: z.object({
    workspaceSlug: z.string().min(1),
    useUserImage: z.boolean(),
    networkImageQuery: z.string().optional().default(""),
    // Pre-staged by stageUserCandidates() — paths are already in derived/,
    // dimensions probed, score seeded.
    userCandidates: z.array(z.unknown()).default([]),
    // Abs path to the largest user image — vision filter reference.
    // null when there were no usable user images.
    referenceImageAbs: z.string().nullable().default(null),
  }),
  outputSchema: z
    .object({
      candidates: z
        .array(
          z
            .object({
              path: z.string().min(1),
              source: z.string().min(1),
              score: z.number().min(0).max(1).optional(),
              deleted: z.boolean().optional(),
            })
            .passthrough(),
        )
        .max(60),
      recommendedPrimaryPath: z.string().min(1),
      networkFetchAttempted: z.boolean().optional(),
      networkFetchFailureReason: z.string().max(500).optional(),
      visionFilterApplied: z.boolean().optional(),
      visionFilterMatches: z.number().int().min(0).max(60).optional(),
      visionFilterRounds: z.number().int().min(0).max(10).optional(),
      refinedQueryUsed: z.string().max(200).optional(),
    })
    .passthrough(),
  invocation: "sync",
  requiredCapabilities: ["image-pick"],
  // ctx → agent.input. Pass-through — PICKER-FORGE's DAG already reads
  // workspaceSlug / useUserImage / networkImageQuery / userCandidates /
  // referenceImageAbs straight from agent.input.
  prepareAgentInput: (ctx) => ({
    workspaceSlug: ctx.workspaceSlug,
    useUserImage: ctx.useUserImage,
    networkImageQuery: ctx.networkImageQuery,
    userCandidates: ctx.userCandidates,
    referenceImageAbs: ctx.referenceImageAbs,
  }),
});

// — relic.regenMetadata —
// Sync. Triggered by admin's "🔄 重新生成" button in the RelicForm
// (app/api/relics/[id]/regen-metadata/route.ts). The caller reads
// `result.runLog` and pulls the research-regen node's output.
export const relicRegenMetadataScene = registerScene({
  key: "relic.regen-metadata",
  module: "relic",
  label: { en: "Regenerate Metadata", zh: "重新生成元数据" },
  description: {
    en: "Re-derive title/subtitle/icon/rarity from existing lore + optional admin feedback.",
    zh: "基于现有圣记和可选反馈，重新派生标题/副标题/图标/稀有度。",
  },
  contextSchema: z.object({
    relicSlug: z.string().min(1),
    existingLore: z.object({
      zh: z.string().min(1),
      en: z.string().min(1),
    }),
    feedback: z.string().max(500).optional(),
  }),
  // Flat shape — regen consumer (regen-metadata route) reads top-level
  // fields directly. Intentionally NOT wrapped in `{ research: ... }` so
  // the regen consumer touches zero code; the two metadata scenes don't
  // need to share a wrapper.
  outputSchema: z
    .object({
      titleZh: cjkRequired(2, 40),
      titleEn: englishStarting(2, 80),
      subtitleZh: cjkRequired(2, 80),
      subtitleEn: englishStarting(2, 160),
      icon: iconKey,
      rarity: z.enum(RARITIES),
    })
    .passthrough(),
  invocation: "sync",
  requiredCapabilities: ["metadata-derivation"],
  // ctx → agent.input. Injects mode discriminator (LORE-FORGE branches
  // on `input.mode`) and renames relicSlug pass-through.
  prepareAgentInput: (ctx) => ({
    mode: "regenMetadata",
    relicSlug: ctx.relicSlug,
    existingLore: ctx.existingLore,
    feedback: ctx.feedback,
  }),
});

// — relic.enhance2d —
// Async. Background-cutout pass turning the relic's primary image into a
// transparent PNG. Runner.maybeWriteRelicAsset writes the result path
// back to Relic.enhancedImagePath on success (input must include
// _relicId + mode for the writeback to fire — set by the binding).
export const relicEnhance2dScene = registerScene({
  key: "relic.enhance2d",
  module: "relic",
  label: { en: "2D Enhance (Cutout)", zh: "2D 增强（抠图）" },
  description: {
    en: "Run BiRefNet over the relic's primary image to produce a transparent PNG.",
    zh: "对主图跑 BiRefNet 抠图，得到透明 PNG。",
  },
  contextSchema: z.object({
    relicId: z.string().min(1),
    relicSlug: z.string().min(1),
    // Pre-encoded by the trigger endpoint (lib/relics/readImageAsDataUri).
    // Replaces the old `primaryImagePath` field — agent DAG no longer needs
    // an INTERNAL slot-0 image-to-data-uri node. New bindings should
    // forward this straight into agent.input via inputMap.
    imageDataUri: z.string().regex(/^data:image\/[a-z+.-]+;base64,/, "expected image data URI"),
  }),
  // `.passthrough()` is essential — the agent's leaf transform also emits
  // `_relicWriteback` which the runner consumes (lib/skills/runtime/runner.ts
  // maybeWriteRelicAsset). Stripping unknowns would break the writeback hook.
  outputSchema: z
    .object({
      enhancedImagePath: z
        .string()
        .min(1)
        .regex(/^\/[A-Za-z0-9_./-]+\.(png|webp|jpg|jpeg)$/i, "expected derived asset path"),
    })
    .passthrough(),
  invocation: "async",
  requiredCapabilities: ["image-cutout"],
  // 3 min SLA — fal.ai BiRefNet typically returns in <30s; anything
  // past 3 min means the API is degraded.
  slaMs: 180_000,
  // ctx → agent.input. `_relicId` underscore-prefixed because the
  // runner's maybeWriteRelicAsset reads it via _relicWriteback envelope
  // produced by the leaf transform; admin's DAG view treats it as
  // metadata, not a normal field.
  //
  // `mode` discriminates the unified RELIC-FORGE-001 omni-agent's 4-way
  // mode branch (initial / regenMetadata / 2dEnhance / 3dCreate).
  // `kind` is consumed by the shared save-asset-relic skill's bodyTemplate
  // — tells /api/internal/save-asset to write the cutout PNG under
  // private/relics/<slug>/derived/enhanced-*.png.
  prepareAgentInput: (ctx) => ({
    relicSlug: ctx.relicSlug,
    imageDataUri: ctx.imageDataUri,
    _relicId: ctx.relicId,
    mode: "2dEnhance",
    kind: "enhanced",
  }),
});

// — relic.create3d —
// Async. Image-to-3D via Meshy. Hard precondition (enforced at the
// endpoint, before dispatch): the relic already has enhancedImagePath
// set — we feed Meshy the transparent PNG, not the original snapshot.
// Runner.maybeWriteRelicAsset writes the GLB path back to Relic.modelPath
// on success.
export const relicCreate3dScene = registerScene({
  key: "relic.create3d",
  module: "relic",
  label: { en: "3D Create (Meshy)", zh: "3D 立体（Meshy）" },
  description: {
    en: "Submit the relic's transparent PNG to Meshy image-to-3D; download GLB on success.",
    zh: "把透明 PNG 提交给 Meshy image-to-3D，完成后下载 GLB。",
  },
  contextSchema: z.object({
    relicId: z.string().min(1),
    relicSlug: z.string().min(1),
    // Pre-encoded by the trigger endpoint (lib/relics/readImageAsDataUri).
    // Replaces the old `enhancedImagePath` field — agent DAG no longer
    // needs an INTERNAL slot-0 image-to-data-uri node.
    imageDataUri: z.string().regex(/^data:image\/[a-z+.-]+;base64,/, "expected image data URI"),
    // Mirrors the Body schema in app/api/relics/[id]/create-3d/route.ts.
    // Plumbed from admin's pre-flight config dialog (Meshy3dConfigModal).
    // The default binding's inputMap fans these out to flat input fields
    // because the meshy-3d handler reads them flat (back-compat).
    opts: z
      .object({
        enablePbr: z.boolean().optional(),
        hdTexture: z.boolean().optional(),
        autoSize: z.boolean().optional(),
        targetFormats: z
          .array(z.enum(["glb", "obj", "fbx", "stl", "usdz", "3mf"]))
          .optional(),
        texturePrompt: z.string().max(600).optional(),
        targetPolycount: z.number().int().min(100).max(300_000).optional(),
        symmetryMode: z.enum(["off", "auto", "on"]).optional(),
        modelType: z.enum(["standard", "lowpoly"]).optional(),
      })
      .optional(),
  }),
  // `.passthrough()` for `_relicWriteback` (see relic.enhance2d note).
  outputSchema: z
    .object({
      modelPath: z
        .string()
        .min(1)
        .regex(/^\/[A-Za-z0-9_./-]+\.glb$/i, "expected GLB path"),
      taskId: z.string().max(120).optional(),
      previewImageUrl: z.string().url().optional(),
      elapsedMs: z.number().int().nonnegative().optional(),
    })
    .passthrough(),
  invocation: "async",
  requiredCapabilities: ["model-3d-generation"],
  // 20 min SLA — Meshy usually returns in 3-10 min, but HD textures
  // can stretch to 15+. Beyond 20 min it's a queue/API problem the
  // user shouldn't have to wait through.
  slaMs: 1_200_000,
  // No retry — re-running submits a brand new (paid) Meshy task and
  // discards whatever the previous attempt was doing. Late success
  // from the original attempt still writes back via the runner hook.
  maxAttempts: 1,
  // ctx → agent.input. Injects `kind: "model"` (save-asset uses it as
  // the persisted filename prefix), `mode: "3dCreate"` (discriminates the
  // RELIC-FORGE-001 omni-agent's 4-way mode branch), and the _relicId
  // envelope for the runner's writeback hook.
  prepareAgentInput: (ctx) => ({
    relicSlug: ctx.relicSlug,
    imageDataUri: ctx.imageDataUri,
    _relicId: ctx.relicId,
    mode: "3dCreate",
    kind: "model",
    opts: ctx.opts,
  }),
});
