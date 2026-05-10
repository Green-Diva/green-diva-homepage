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
import { registerScene } from "@/lib/agent-service";

// — relic.draftMetadata —
// Sync. Triggered from the draft pipeline's GENERATE_METADATA step
// (lib/relics/pipeline/steps/generateMetadata.ts). The caller reads
// `result.runLog` to pull per-node outputs (research / pick) — the leaf
// agent.output isn't enough because pipeline writeback needs both.
//
// outputSchema is z.unknown() because the runLog drives extraction;
// Phase 5+ may tighten this once we have a richer template syntax for
// runLog navigation.
export const relicDraftMetadataScene = registerScene({
  key: "relic.draft-metadata",
  module: "relic",
  label: { en: "Draft Metadata Generation", zh: "草稿元数据生成" },
  description: {
    en: "Run the relic scribe over a draft workspace to produce lore + metadata + candidate images.",
    zh: "对草稿工作目录跑 relic scribe，生成圣记、元数据和候选图。",
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
  outputSchema: z.unknown(),
  invocation: "sync",
  // image-pick lives in a separate scene (relic.smart-image-pick) since
  // the Phase 8 picker decomposition. LORE-FORGE no longer claims it.
  requiredCapabilities: ["lore-writing", "metadata-derivation"],
});

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
  outputSchema: z.object({
    candidates: z.array(z.unknown()),
    recommendedPrimaryPath: z.string(),
    networkFetchAttempted: z.boolean().optional(),
    networkFetchFailureReason: z.string().optional(),
    visionFilterApplied: z.boolean().optional(),
    visionFilterMatches: z.number().optional(),
    visionFilterRounds: z.number().optional(),
    refinedQueryUsed: z.string().optional(),
  }),
  invocation: "sync",
  requiredCapabilities: ["image-pick"],
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
    en: "Re-derive title/subtitle/icon/rarity/formKind from existing lore + optional admin feedback.",
    zh: "基于现有圣记和可选反馈，重新派生标题/副标题/图标/稀有度/形态。",
  },
  contextSchema: z.object({
    relicSlug: z.string().min(1),
    existingLore: z.object({
      zh: z.string().min(1),
      en: z.string().min(1),
    }),
    feedback: z.string().max(500).optional(),
  }),
  outputSchema: z.unknown(),
  invocation: "sync",
  requiredCapabilities: ["metadata-derivation"],
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
  outputSchema: z.object({
    enhancedImagePath: z.string().min(1),
  }),
  invocation: "async",
  requiredCapabilities: ["image-cutout"],
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
  outputSchema: z.object({
    modelPath: z.string().min(1),
    taskId: z.string().optional(),
    previewImageUrl: z.string().optional(),
    elapsedMs: z.number().optional(),
  }),
  invocation: "async",
  requiredCapabilities: ["model-3d-generation"],
});
