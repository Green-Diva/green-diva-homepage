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
import { SMOKE_PHOTO_DATA_URI } from "@/lib/relics/smokeFixtures";

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
// Keep aligned with lib/relicValidators.ts RARITIES + DB enum Rarity +
// DEFAULT_METADATA_PROMPT in lib/skills/relic-prompts.ts. UNCOMMON is
// not a real grade in this system; SPECIAL is.
const RARITIES = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;

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
  // Deploy-gate / Test-Run smoke ctx (2026-05-15). Uses an empty image
  // set + fictional brief so the Lore Forge DAG exercises Gemini metadata
  // derivation without needing real workspace files. The downstream
  // pipeline step that writes metadata back to RelicDraft is NOT invoked
  // (test runs `executeAgent` directly, not the draft pipeline runner),
  // so this is fs-safe.
  sampleCtx: {
    workspaceSlug: "_smoke-test",
    userBrief: "A fictional relic used only for agent smoke-testing. Generate plausible bilingual metadata.",
    fileSummary: "(smoke test — no workspace files)",
    imageAbsPaths: [],
    textExcerpts: "",
  },
});

// Legacy alias — drop after SceneBinding.sceneKey rows have been migrated.
registerSceneAlias("relic.draft-metadata", "relic.generate-draft-metadata");

// — relic.networkImageSearch —
// Sync. Triggered by admin's "图片搜索" tab in NetworkCandidateModal
// (app/api/relics/[id]/lens-search/route.ts).
//
// The trigger endpoint reads the relic's primary image off disk twice:
//   - once as raw base64 → passed to Vision API (referenceImageBase64)
//   - once as a temp file copy in derived/lens-ref-*.<ext> → passed by
//     abs path so the agent's vision-similarity-score (Gemini) skill can
//     read it via imagePathsField (Gemini handler reads from disk paths)
//
// No _relicWriteback — admin reviews matches in the modal and per-pick
// triggers POST /api/relics/[id]/candidate (JSON branch). Persistence is
// not the agent's job here.
export const relicNetworkImageSearchScene = registerScene({
  key: "relic.network-image-search",
  module: "relic",
  label: { en: "Network Image Reverse Search", zh: "网络反向图片搜索" },
  description: {
    en: "Reverse-image-search the relic's primary via Google Cloud Vision WEB_DETECTION; vision-score candidates with Gemini.",
    zh: "用 Google Cloud Vision WEB_DETECTION 对主图反向搜索；Gemini 视觉打分候选。",
  },
  contextSchema: z.object({
    relicId: z.string().min(1),
    relicSlug: z.string().min(1),
    // Raw base64 of the relic's primary image (no `data:image/...;base64,`
    // prefix). Vision API's `image.content` field expects bare base64.
    referenceImageBase64: z.string().min(1),
    // Abs path to a temp copy of the primary image in derived/. Gemini's
    // vision skill (imagePathsField) reads from disk; we'd duplicate the
    // base64 → temp-file dance via a persist primitive otherwise. The
    // trigger endpoint owns this write to keep the agent DAG focused on
    // outbound API calls.
    referenceImageAbs: z.string().min(1),
  }),
  outputSchema: z
    .object({
      matches: z
        .array(
          z.object({
            imageUrl: z.string().url(),
            sourceUrl: z.string().url(),
            thumbnailUrl: z.string().url().optional(),
            title: z.string().max(300).optional(),
            score: z.number().min(0).max(100),
          }),
        )
        .max(20),
    })
    .passthrough(),
  invocation: "sync",
  // 120 s SLA — Vision API ~3 s + 8 sequential Gemini scoring calls
  // (~5-8 s each) + 8 downloads. Empirically lands 50-90 s for the typical
  // case. 60 s was too tight (timed out mid-scoring on first real test).
  slaMs: 120_000,
  requiredCapabilities: ["lens-reverse-search", "vision-scoring"],
  prepareAgentInput: (ctx) => ({
    referenceImageBase64: ctx.referenceImageBase64,
    referenceImageAbs: ctx.referenceImageAbs,
    relicSlug: ctx.relicSlug,
  }),
  // Test-Run smoke ctx (2026-05-15). Reference image is a 1×1 PNG; this
  // is deliberately useless as a Vision query (zero matches expected),
  // but the call path through Vision API + Gemini scoring still
  // exercises end-to-end. ensureSmokeFixtures() in lib/relics/smokeFixtures.ts
  // writes the reference PNG to disk before each test run so the Gemini
  // vision skill (imagePathsField) can read it.
  sampleCtx: {
    relicId: "_smoke-test-id",
    relicSlug: "_smoke-test",
    referenceImageBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P//PwAFBwIAnwEYjwAAAABJRU5ErkJggg==",
    referenceImageAbs: "/tmp/_smoke-test-ref.png",
  },
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
  // Deploy-gate smoke test (2026-05-15). Pure LLM path — no FS lookups
  // against relicSlug, no _relicWriteback. Burns one Gemini call per
  // deploy of any agent claiming this scene; cost is bounded.
  sampleCtx: {
    relicSlug: "_smoke-test",
    existingLore: {
      zh: "这是一件用于部署冒烟测试的虚构圣物。它通体由墨绿色辉石雕成，表面刻有失传文字,据传能在持有者梦中低语未完成的承诺。",
      en: "A fictional relic used solely for deploy smoke-testing. Carved from a single piece of dark green olivine, its surface bears glyphs from a lost script said to whisper unfulfilled promises into the dreams of whoever holds it.",
    },
    feedback: "",
  },
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
    // The candidate path that this enhance was generated FROM. Carried
    // through the DAG so the shape transform can stamp it into
    // enhancedItem, and the runner's writeback hook uses it as the upsert
    // key — re-enhancing the same candidate overwrites its previous entry
    // in Relic.enhancedImages instead of appending a new row.
    sourceCandidatePath: z.string().min(1),
    // fal.ai BiRefNet input knobs surfaced to admin via Cutout2dConfigModal
    // (app/admin/relics/Cutout2dConfigModal.tsx). All optional with sane
    // defaults so existing callers (or smoke test) get the previous
    // behaviour without changes. Cross-field constraint (2304 needs
    // Dynamic) is enforced at the trigger endpoint, not here, because
    // zod's chained refinement would conflict with `.default()`.
    model: z
      .enum([
        "General Use (Light)",
        "General Use (Light 2K)",
        "General Use (Heavy)",
        "Matting",
        "Portrait",
        "General Use (Dynamic)",
      ])
      .optional()
      .default("General Use (Light)"),
    operatingResolution: z
      .enum(["1024x1024", "2048x2048", "2304x2304"])
      .optional()
      .default("1024x1024"),
    refineForeground: z.boolean().optional().default(true),
  }),
  // `.passthrough()` is essential — the agent's leaf transform also emits
  // `_relicWriteback` which the runner consumes (lib/skills/runtime/runner.ts
  // maybeWriteRelicAsset). Stripping unknowns would break the writeback hook.
  //
  // Returns an `enhancedItem` envelope (path + source + params) — the runner
  // takes it and does a read-modify-write upsert into Relic.enhancedImages
  // keyed by sourceCandidatePath, capped at 16 entries.
  outputSchema: z
    .object({
      enhancedItem: z
        .object({
          path: z
            .string()
            .min(1)
            .regex(/^\/[A-Za-z0-9_./-]+\.(png|webp|jpg|jpeg)$/i, "expected derived asset path"),
          sourceCandidatePath: z.string().min(1),
          model: z.string().min(1),
          operatingResolution: z.string().min(1),
          refineForeground: z.boolean(),
          createdAt: z.string().min(1),
        })
        .passthrough(),
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
  //
  // model / operatingResolution / refineForeground are forwarded to the
  // fal-cutout-http skill via the cutout DAG node's inputFrom merge
  // (prisma/migrate-relic-forge.ts). camelCase here; fal expects snake_case
  // (operating_resolution / refine_foreground) — bodyTemplate in
  // prisma/migrate-cutout-forge.ts does the translation.
  prepareAgentInput: (ctx) => ({
    relicSlug: ctx.relicSlug,
    imageDataUri: ctx.imageDataUri,
    sourceCandidatePath: ctx.sourceCandidatePath,
    _relicId: ctx.relicId,
    mode: "2dEnhance",
    kind: "enhanced",
    model: ctx.model,
    operatingResolution: ctx.operatingResolution,
    refineForeground: ctx.refineForeground,
  }),
  // Test-Run smoke ctx (2026-05-15). 128×128 JPEG with a clear foreground
  // subject (see SMOKE_PHOTO_DATA_URI). Will trigger fal.ai cutout (~$0.01)
  // + write a persist-output file under
  // private/relics/_smoke-test/derived/enhanced-*.png. `_relicId` points
  // at a non-existent relic id so the runner's _relicWriteback hook
  // silently no-ops (relic row not found → update skipped, no DB churn).
  sampleCtx: {
    relicId: "_smoke-test-id",
    relicSlug: "_smoke-test",
    imageDataUri: SMOKE_PHOTO_DATA_URI,
    sourceCandidatePath: "/_smoke-test/source/smoke.jpg",
    model: "General Use (Light)",
    operatingResolution: "1024x1024",
    refineForeground: true,
  },
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
    // 2026-05-20: multi-image — 1..4 transparent PNG data URIs pre-encoded
    // by the trigger endpoint (lib/relics/readImageAsDataUri). Admin picks
    // 1-4 enhance sources in Meshy3dConfigModal; the API loads all and
    // hands them to Meshy's /multi-image-to-3d endpoint for multi-view
    // fusion. A single-image flow = array of length 1.
    imageDataUris: z
      .array(z.string().regex(/^data:image\/[a-z+.-]+;base64,/, "expected image data URI"))
      .min(1)
      .max(4),
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
    imageDataUris: ctx.imageDataUris,
    _relicId: ctx.relicId,
    mode: "3dCreate",
    kind: "model",
    opts: ctx.opts,
  }),
  // Test-Run smoke ctx (2026-05-15). ⚠️ EXPENSIVE — submits a real Meshy
  // image-to-3D task (~$0.20-$0.50, 3-15 min). Use this sparingly. The
  // 128×128 SMOKE_PHOTO_DATA_URI will produce a low-fidelity model but
  // exercises the submit → poll → download → persist path end-to-end.
  // Admin should uncheck this scene in Test Run unless explicitly
  // validating the Meshy pipeline.
  sampleCtx: {
    relicId: "_smoke-test-id",
    relicSlug: "_smoke-test",
    imageDataUris: [SMOKE_PHOTO_DATA_URI],
    // Mirror the production /api/relics/[id]/create-3d defaulting (opts = {}).
    // Without this, prepareAgentInput injects `opts: undefined` into agent.input,
    // the meshy node's merge surfaces `{ opts: undefined }`, and the skill
    // inputSchema validator (`"opts" in value` is true for an `undefined`-valued
    // key) rejects it as `expected object, got undefined` — failing the smoke
    // test at 0.0s before any Meshy submit.
    opts: {},
  },
});
