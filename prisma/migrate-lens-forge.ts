// Provisions LENS-FORGE-001 — the agent that satisfies the
// `relic.network-image-search` scene. Run by `npm start` after
// migrate-shared-network-skills.ts (which seeds the shared
// `download-network-image` skill LENS equips on slot 1).
//
// Originally PICKER-FORGE-001's migration created the shared download
// skill, but PICKER was retired 2026-05-14 (see migrate-picker-removal.ts
// + migrate-picker-forge.ts header). Pre-flight findUnique on the slug
// throws a clear error if the shared-skills migration hasn't been run.
//
// What it creates (idempotent — checks existing rows by slug/codename):
//   1. Skill "lens-reverse-search"        (HTTP_API POST, Google Cloud Vision WEB_DETECTION)
//   2. Skill "vision-similarity-score"    (LLM_PROMPT gemini, two-image 0-100 score)
//   3. Looks up existing "download-network-image" (created by migrate-picker-forge)
//   4. Agent "LENS-FORGE-001"             (MECHANICAL, 4-node DAG + forEach body)
//   5. SceneBinding for relic.network-image-search → LENS-FORGE-001
//
// Required env (admin must add to .env):
//   - GOOGLE_CLOUD_VISION_KEY  — Google Cloud Vision API key with WEB_DETECTION enabled
// Soft-required (warn on absence; agent runtime fails clearly):
//   - GEMINI_API_KEY           — already required by lore-forge / picker-forge

import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const NEW_AGENT_CODENAME = "LENS-FORGE-001";
const SCENE_KEY = "relic.network-image-search";

// — — Skill specs — — — — — — — — — — — — — — — — — — — — — — — — — —

const SKILL_LENS = {
  slug: "lens-reverse-search",
  nameEn: "Vision Reverse Image Search",
  nameZh: "视觉反向图片搜索",
  icon: "image_search",
  descriptionEn:
    "Calls Google Cloud Vision API WEB_DETECTION with the supplied base64-encoded image. Returns the raw response — downstream transform extracts pagesWithMatchingImages and shapes per-candidate {imageUrl, sourceUrl, ...}.",
  descriptionZh:
    "用入参 base64 调 Google Cloud Vision WEB_DETECTION。返回原始响应——下游 transform 抽 pagesWithMatchingImages 并整形为 {imageUrl, sourceUrl, ...}。",
  kind: "HTTP_API" as const,
  handlerConfig: {
    method: "POST",
    url: "https://vision.googleapis.com/v1/images:annotate",
    authEnv: "GOOGLE_CLOUD_VISION_KEY",
    authScheme: "QueryParam",
    authQueryParam: "key",
    bodyTemplate: {
      requests: [
        {
          image: { content: "{{referenceImageBase64}}" },
          features: [{ type: "WEB_DETECTION", maxResults: 50 }],
        },
      ],
    },
    timeoutMs: 30_000,
    responseType: "json",
  } as Prisma.InputJsonValue,
  inputSchema: {
    type: "object",
    properties: {
      referenceImageBase64: {
        type: "string",
        description:
          "Raw base64 of the reference image (no data:image/...;base64, prefix). Vision API's image.content field expects bare base64.",
      },
    },
    required: ["referenceImageBase64"],
  } as Prisma.InputJsonValue,
};

const VISION_SCORE_PROMPT = [
  "You score VISUAL SIMILARITY between TWO product images.",
  "Image 1 = REFERENCE (the user's actual item).",
  "Image 2 = CANDIDATE (a network-found image to evaluate).",
  "",
  "Output STRICT JSON in this shape (no markdown, no prose, no code fences):",
  '  { "score": <integer 0-100>, "rationale": "<≤80 chars>" }',
  "",
  "Scoring rubric:",
  "  100      — exact same product (same SKU/edition photographed differently)",
  "   80-99   — same product family, very similar silhouette + color palette",
  "   50-79   — related product (same category) with weak visual match",
  "    0-49   — unrelated / different product",
  "",
  "Weights: silhouette 50% / color palette 30% / packaging or printed text 20%.",
  "Be conservative — don't inflate scores for partial matches.",
].join("\n");

const SKILL_VISION_SCORE = {
  slug: "vision-similarity-score",
  nameEn: "Vision Similarity Score",
  nameZh: "视觉相似度评分",
  icon: "compare",
  descriptionEn:
    "Gemini 2.5 multi-image: scores visual similarity between a reference image and a single candidate image on a 0-100 scale. Used by LENS-FORGE inside its forEach scoring loop.",
  descriptionZh:
    "Gemini 2.5 双图视觉:对参考图和单张候选图打 0-100 相似度分。供 LENS-FORGE forEach 打分循环使用。",
  kind: "LLM_PROMPT" as const,
  handlerConfig: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    authEnv: "GEMINI_API_KEY",
    grounding: false,
    imagePathsField: "imageAbsPaths",
    // Gemini 2.5-flash counts internal thinking tokens against maxOutputTokens.
    // 512 wasn't enough — Gemini burned most of the budget thinking and emitted
    // an empty / truncated response, then JSON.parse threw OUTPUT_PARSE.
    // Match PICKER's vision-compare-candidates (2048) which works in practice.
    maxTokens: 2048,
    responseFormat: "json",
    systemPrompt: VISION_SCORE_PROMPT,
    userTemplate: "Score image 1 (REFERENCE) vs image 2 (CANDIDATE) on a 0-100 visual-similarity scale.",
  } as Prisma.InputJsonValue,
  inputSchema: {
    type: "object",
    properties: {
      imageAbsPaths: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 2,
        description:
          "Two absolute filesystem paths. Index 0 = reference, index 1 = candidate to score against the reference.",
      },
    },
    required: ["imageAbsPaths"],
  } as Prisma.InputJsonValue,
};

// — — DAG — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
//
// Top-level (4 nodes):
//   lens (skill 0) → normalize (transform) → forEachScore (forEach) → finalShape (transform)
//
// forEach body (5 nodes):
//   dl (skill 1) → tmpPersist (persist) → prepScore (transform) → score (skill 2) → mkResult (transform)
//
// Notes:
//   - Vision API does NOT support pagination; single call returns up to 50
//     pagesWithMatchingImages sorted by relevance. We take the first 10.
//   - forEach aborts on first item failure (download 404, etc). Acceptable
//     trade-off for v1 — admin retries (rate-limited 1/min/relic). If this
//     becomes painful, add forEach `errorPolicy: skip` as a runtime feature.
//   - Score scoring is per-item (one Gemini call per candidate) rather
//     than batched multi-image, so admins can see per-iteration runLog
//     entries when debugging which candidate scored low.

// 8 = sweet spot empirically: each Gemini scoring call takes 5-8 s, so
// 8 items keeps total wall-clock under ~75 s (Vision + downloads + score),
// comfortably inside the 120 s scene timeout. Bumping higher risks hitting
// the timeout for slow days. Lower would shrink the candidate pool.
const FOREACH_MAX_ITEMS = 8;
const TOP_N_RESULTS = 10;

// Vision API WEB_DETECTION returns multiple result tiers we care about:
//   pagesWithMatchingImages  — visually-matching images PLUS the source page
//                              they live on. Best for our "image+reference"
//                              semantics — gives both imageUrl and sourceUrl.
//   visuallySimilarImages    — visually similar but NO source page. Common
//                              when matched images live on CDNs without a
//                              clear hosting page. We use the image URL as
//                              its own sourceUrl (degenerate but lets admin
//                              still add it as a candidate; the link in the
//                              candidate row points at the image directly).
// Empirically (relic 025 test), Vision often returns 0 pages and 20+ similar
// images for everyday consumer products. Without the fallback the search
// would always come back empty.
//
// Output guarantees `items` is ALWAYS an array (possibly empty) — JSONata
// silently drops object keys whose value evaluates to nothing, which would
// then crash forEachScore with FOREACH_INPUT_NOT_ARRAY.
const EXPR_NORMALIZE = `(
  $wd := results.responses[0].webDetection;
  $pageItems := (
    ($wd.pagesWithMatchingImages[url and ($exists(partialMatchingImages[0].url) or $exists(fullMatchingImages[0].url))])
    ~> | $ | {
      "imageUrl": ($exists(partialMatchingImages[0].url) ? partialMatchingImages[0].url : fullMatchingImages[0].url),
      "sourceUrl": url,
      "thumbnailUrl": ($exists(partialMatchingImages[0].url) ? partialMatchingImages[0].url : fullMatchingImages[0].url),
      "title": pageTitle,
      "relicSlug": $$.relicSlug,
      "referenceImageAbs": $$.referenceImageAbs,
      "kind": "lens-tmp"
    } |
  );
  $simItems := (
    $wd.visuallySimilarImages[url]
    ~> | $ | {
      "imageUrl": url,
      "sourceUrl": url,
      "thumbnailUrl": url,
      "title": "visually similar",
      "relicSlug": $$.relicSlug,
      "referenceImageAbs": $$.referenceImageAbs,
      "kind": "lens-tmp"
    } |
  );
  $combined := $append($append([], $pageItems), $simItems);
  $sliced := $combined[[0..${FOREACH_MAX_ITEMS - 1}]];
  {
    "items": ($exists($sliced) ? [$sliced] : []),
    "referenceImageAbs": referenceImageAbs,
    "relicSlug": relicSlug
  }
)`;

const EXPR_PREP_SCORE = `{
  "imageAbsPaths": [ref, cand]
}`;

const EXPR_MK_RESULT = `{
  "imageUrl": item.imageUrl,
  "sourceUrl": item.sourceUrl,
  "thumbnailUrl": item.thumbnailUrl,
  "title": item.title,
  "score": ($exists(score) and score >= 0 and score <= 100 ? score : 0)
}`;

// $append([], ...) guarantees the value is an array even when the mapping
// yields an empty sequence (Vision returned 0 usable matches). Without this
// guard JSONata drops the `matches` key entirely and the scene outputSchema
// rejects the agent output with "matches: Required". Same trick as
// EXPR_NORMALIZE above.
const EXPR_FINAL_SHAPE = `{
  "matches": $append([],
    $sort($, function($a, $b) { $b.score > $a.score })
      [[0..${TOP_N_RESULTS - 1}]]
      ~> | $ | {
        "imageUrl": $.imageUrl,
        "sourceUrl": $.sourceUrl,
        "thumbnailUrl": $.thumbnailUrl,
        "title": $.title,
        "score": $.score
      } |
  )
}`;

const FOREACH_BODY = {
  nodes: [
    {
      id: "dl",
      type: "skill" as const,
      slotIndex: 1,
      inputFrom: { merge: { url: "agent.input.item.imageUrl" } },
      position: { x: 60, y: 100 },
    },
    {
      id: "tmpPersist",
      type: "persist" as const,
      inputFrom: {
        merge: {
          relicSlug: "agent.input.item.relicSlug",
          kind: "agent.input.item.kind",
          base64: "dl.output.base64",
          contentType: "dl.output.contentType",
        },
      },
      position: { x: 260, y: 100 },
    },
    {
      id: "prepScore",
      type: "transform" as const,
      inputFrom: {
        merge: {
          ref: "agent.input.item.referenceImageAbs",
          cand: "tmpPersist.output.absPath",
        },
      },
      expression: EXPR_PREP_SCORE,
      position: { x: 460, y: 100 },
    },
    {
      id: "score",
      type: "skill" as const,
      slotIndex: 2,
      inputFrom: "prepScore.output",
      position: { x: 660, y: 100 },
    },
    {
      id: "mkResult",
      type: "transform" as const,
      inputFrom: {
        merge: {
          item: "agent.input.item",
          score: "score.output.score",
        },
      },
      expression: EXPR_MK_RESULT,
      position: { x: 860, y: 100 },
    },
  ],
  edges: [
    { from: "dl", to: "tmpPersist" },
    { from: "tmpPersist", to: "prepScore" },
    { from: "prepScore", to: "score" },
    { from: "score", to: "mkResult" },
  ],
};

const TOP_LEVEL_PIPELINE = {
  version: 2 as const,
  nodes: [
    {
      id: "lens",
      type: "skill" as const,
      slotIndex: 0,
      inputFrom: {
        merge: { referenceImageBase64: "agent.input.referenceImageBase64" },
      },
      position: { x: 60, y: 200 },
    },
    {
      id: "normalize",
      type: "transform" as const,
      inputFrom: {
        merge: {
          results: "lens.output",
          relicSlug: "agent.input.relicSlug",
          referenceImageAbs: "agent.input.referenceImageAbs",
        },
      },
      expression: EXPR_NORMALIZE,
      position: { x: 260, y: 200 },
    },
    {
      id: "forEachScore",
      type: "forEach" as const,
      // forEach inputFrom must resolve to an array directly (not an object).
      // normalize.output.items is the array of candidates.
      inputFrom: "normalize.output.items",
      maxItems: FOREACH_MAX_ITEMS,
      aggregate: "concat-array" as const,
      body: FOREACH_BODY,
      position: { x: 460, y: 200 },
    },
    {
      id: "finalShape",
      type: "transform" as const,
      inputFrom: "forEachScore.output",
      expression: EXPR_FINAL_SHAPE,
      position: { x: 660, y: 200 },
    },
  ],
  edges: [
    { from: "lens", to: "normalize" },
    { from: "normalize", to: "forEachScore" },
    { from: "forEachScore", to: "finalShape" },
  ],
};

// — — Runtime — — — — — — — — — — — — — — — — — — — — — — — — — — — —

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(12).toString("hex").slice(0, 21 - ts.length);
  return `c${ts}${rand}`.padEnd(25, "0").slice(0, 25);
}

type SkillSpec = typeof SKILL_LENS | typeof SKILL_VISION_SCORE;

async function ensureSkill(prisma: PrismaClient, spec: SkillSpec): Promise<string> {
  const existing = await prisma.skill.findUnique({ where: { slug: spec.slug } });
  if (existing) {
    await prisma.skill.update({
      where: { id: existing.id },
      data: {
        handlerConfig: spec.handlerConfig,
        inputSchema: spec.inputSchema,
        nameEn: spec.nameEn,
        nameZh: spec.nameZh,
        descriptionEn: spec.descriptionEn,
        descriptionZh: spec.descriptionZh,
        kind: spec.kind,
        status: "ONLINE",
      },
    });
    console.log(
      `[migrate-lens-forge] skill "${spec.slug}" exists (${existing.id}); healed config`,
    );
    return existing.id;
  }
  const created = await prisma.skill.create({
    data: {
      slug: spec.slug,
      nameEn: spec.nameEn,
      nameZh: spec.nameZh,
      icon: spec.icon,
      descriptionEn: spec.descriptionEn,
      descriptionZh: spec.descriptionZh,
      kind: spec.kind,
      handlerConfig: spec.handlerConfig,
      inputSchema: spec.inputSchema,
      status: "ONLINE",
    },
    select: { id: true },
  });
  console.log(`[migrate-lens-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
}

async function findDownloadSkill(prisma: PrismaClient): Promise<string> {
  const dl = await prisma.skill.findUnique({
    where: { slug: "download-network-image" },
    select: { id: true },
  });
  if (!dl) {
    throw new Error(
      "[migrate-lens-forge] required skill 'download-network-image' not found — run migrate-picker-forge.ts first",
    );
  }
  return dl.id;
}

async function ensureForgeAgent(
  prisma: PrismaClient,
  skillIds: { lens: string; download: string; score: string },
): Promise<string> {
  const existing = await prisma.agent.findUnique({
    where: { codename: NEW_AGENT_CODENAME },
  });
  if (existing) {
    await prisma.agent.update({
      where: { id: existing.id },
      data: {
        pipelineConfig: TOP_LEVEL_PIPELINE as unknown as Prisma.InputJsonValue,
        capabilities: ["lens-reverse-search", "vision-scoring"],
      },
    });
    for (const [slotIndex, skillId] of [
      [0, skillIds.lens],
      [1, skillIds.download],
      [2, skillIds.score],
    ] as const) {
      const eq = await prisma.agentSkillEquip.findFirst({
        where: { agentId: existing.id, slotIndex },
      });
      if (!eq) {
        await prisma.agentSkillEquip.create({
          data: { agentId: existing.id, skillId, slotIndex, unlocked: true },
        });
        console.log(
          `[migrate-lens-forge] re-equipped ${NEW_AGENT_CODENAME} slot ${slotIndex}`,
        );
      } else if (eq.skillId !== skillId) {
        await prisma.agentSkillEquip.update({
          where: { id: eq.id },
          data: { skillId },
        });
        console.log(
          `[migrate-lens-forge] swapped slot ${slotIndex} skill on ${NEW_AGENT_CODENAME}`,
        );
      }
    }
    console.log(
      `[migrate-lens-forge] agent ${NEW_AGENT_CODENAME} exists (${existing.id}); healed shape`,
    );
    return existing.id;
  }

  const id = genCuid();
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        id,
        codename: NEW_AGENT_CODENAME,
        codenameZh: "镜瞳熔炉",
        nameEn: "Lens Forge",
        nameZh: "镜瞳熔炉",
        mode: "MECHANICAL",
        status: "DEPLOYED",
        avatarUrl: "/images/agent-control/avatars/placeholder.svg",
        capabilities: ["lens-reverse-search", "vision-scoring"],
        pipelineConfig: TOP_LEVEL_PIPELINE as unknown as Prisma.InputJsonValue,
        deployedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.agentSkillEquip.createMany({
      data: [
        { agentId: agent.id, skillId: skillIds.lens, slotIndex: 0, unlocked: true },
        { agentId: agent.id, skillId: skillIds.download, slotIndex: 1, unlocked: true },
        { agentId: agent.id, skillId: skillIds.score, slotIndex: 2, unlocked: true },
      ],
    });
    return agent;
  });
  console.log(
    `[migrate-lens-forge] created agent ${NEW_AGENT_CODENAME} (${result.id}) + 3 equips (slots 0/1/2; 3-5 empty)`,
  );
  return result.id;
}

async function bindScene(prisma: PrismaClient, forgeId: string): Promise<void> {
  const existing = await prisma.sceneBinding.findUnique({
    where: { sceneKey: SCENE_KEY },
  });
  if (existing) {
    await prisma.sceneBinding.update({
      where: { sceneKey: SCENE_KEY },
      data: {
        agentId: forgeId,
        enabled: true,
        notes:
          "LENS-FORGE-001: Vision API WEB_DETECTION + per-candidate Gemini scoring. Single SerpAPI-free pass.",
      },
    });
    console.log(`[migrate-lens-forge] healed binding for ${SCENE_KEY}`);
    return;
  }
  await prisma.sceneBinding.create({
    data: {
      sceneKey: SCENE_KEY,
      agentId: forgeId,
      enabled: true,
      notes:
        "LENS-FORGE-001: Vision API WEB_DETECTION + per-candidate Gemini scoring. Single SerpAPI-free pass.",
    },
  });
  console.log(`[migrate-lens-forge] bound ${SCENE_KEY} → ${NEW_AGENT_CODENAME}`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log(
        "[migrate-lens-forge] SceneBinding table absent — skip (run earlier migrations first)",
      );
      return;
    }

    const lensId = await ensureSkill(prisma, SKILL_LENS);
    const scoreId = await ensureSkill(prisma, SKILL_VISION_SCORE);
    const downloadId = await findDownloadSkill(prisma);

    const forgeId = await ensureForgeAgent(prisma, {
      lens: lensId,
      download: downloadId,
      score: scoreId,
    });
    await bindScene(prisma, forgeId);

    console.log("[migrate-lens-forge] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-lens-forge] failed:", e);
  process.exit(1);
});
