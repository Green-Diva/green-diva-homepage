// ⚠️ DEPRECATED 2026-05-14 — file kept for git history only.
//
// PICKER-FORGE-001 was permanently removed. This script is no longer in
// the npm start chain (see package.json). The functionality has been
// split:
//   - download-network-image  → migrate-shared-network-skills.ts
//   - SceneBinding cleanup    → migrate-picker-removal.ts
//   - LENS-FORGE-001 search   → migrate-lens-forge.ts (different scene)
//
// To resurrect: re-add to package.json start chain BEFORE
// migrate-picker-removal (otherwise the agent gets created and immediately
// deleted) — and restore a SceneBinding for relic.smart-image-pick.
//
// Original purpose follows.
//
// Provisions PICKER-FORGE-001 — replaces the relic-smart-image-pick
// INTERNAL handler with a 4-skill DAG built on the Phase 8 backbone
// primitives (loop / forEach / transform).
//
// What it creates (idempotent — checks for existing rows by slug/codename):
//   1. Skill "serp-image-search"            (HTTP_API GET, QueryParam auth)
//   2. Skill "download-network-image"       (HTTP_API GET binary)
//   3. Skill "vision-compare-candidates"    (LLM_PROMPT gemini multi-image)
//   4. Agent "PICKER-FORGE-001"             (MECHANICAL, 3-slot DAG)
//   5. SceneBinding for relic.smart-image-pick → PICKER-FORGE-001
//
// 2026-05-13: the former "save-network-asset" HTTP_API skill (slot 3) was
// retired in favor of the backbone `persist` primitive node. Slots are now
// 1=serp / 2=download / 4=vision (slot 3 stays empty for hash compatibility
// with prior DAG node ids).
//
// User candidates are pre-staged at the pipeline layer
// (lib/relics/pipeline/stageUserCandidates.ts) so the picker DAG only
// handles the network-search + vision-filter + ranking flow.
//
// Required env: DATABASE_URL.
// Soft-required env (degrade-to-user-only if absent):
//   - SERPAPI_KEY  — needed for the network-search slot.
//   - GEMINI_API_KEY — vision compare.

import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const NEW_AGENT_CODENAME = "PICKER-FORGE-001";

// — — Skill specs — — — — — — — — — — — — — — — — — — — — — — — — — —

const SKILL_SERP = {
  slug: "serp-image-search",
  nameEn: "SerpAPI Image Search",
  nameZh: "SerpAPI 图片搜索",
  icon: "search",
  descriptionEn:
    "Calls SerpAPI google_images with the supplied query. Returns the raw response — downstream transform filters watermarks / sorts by area / slices top N.",
  descriptionZh:
    "用入参 query 调 SerpAPI google_images。返回原始响应——下游 transform 过滤水印 / 按面积排序 / 取前 N。",
  kind: "HTTP_API" as const,
  handlerConfig: {
    method: "GET",
    url: "https://serpapi.com/search.json",
    authEnv: "SERPAPI_KEY",
    authScheme: "QueryParam",
    authQueryParam: "api_key",
    queryTemplate: {
      engine: "google_images",
      q: "{{query}}",
      ijn: "0",
    },
    timeoutMs: 30_000,
    responseType: "json",
  } as Prisma.InputJsonValue,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Google Images search query, e.g. product name + brand + edition. Be specific." },
    },
    required: ["query"],
  } as Prisma.InputJsonValue,
};

const SKILL_DOWNLOAD = {
  slug: "download-network-image",
  nameEn: "Download Network Image (binary)",
  nameZh: "下载网络图片(二进制)",
  icon: "download",
  descriptionEn:
    "GETs an arbitrary image URL and returns { base64, contentType, bytes, url }. No auth — used inside forEach loops to fetch SerpAPI candidate images.",
  descriptionZh:
    "GET 任意图片 URL,返回 { base64, contentType, bytes, url }。无鉴权——在 forEach 循环里抓取 SerpAPI 候选图。",
  kind: "HTTP_API" as const,
  handlerConfig: {
    method: "GET",
    url: "{{url}}",
    responseType: "binary",
    binaryMaxBytes: 10 * 1024 * 1024,
    timeoutMs: 30_000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GreenDiva/1.0)",
    },
  } as Prisma.InputJsonValue,
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL of an image to fetch." },
    },
    required: ["url"],
  } as Prisma.InputJsonValue,
};

// (2026-05-13) save-network-asset HTTP_API skill retired — replaced by
// the backbone `persist` primitive node in the forEach body. See
// migrate-replace-save-asset.ts for the cleanup of stale rows + DAG
// rewrites in existing databases.

// Prompt body — same content as the historical INTERNAL handler's
// DEFAULT_VISION_PROMPT_WITH_REFINE, hoisted here as a constant so it's
// editable in handlerConfig without a code commit.
const VISION_SYSTEM_PROMPT = [
  "You compare a user's reference photo against candidate images to identify the EXACT same product (not just similar items from the same brand or series).",
  "",
  "The FIRST image is the REFERENCE — what the user actually has. The remaining images are CANDIDATES from a Google Image search.",
  "",
  "For each candidate, decide whether it depicts the SAME PHYSICAL PRODUCT as the reference. Manufacturers ship many similar-looking products in the same series — identical-looking sculpts and packaging styles are common between different SKUs. A different SKU = NOT a match, even if visually close.",
  "",
  "Output STRICT JSON in this shape (no markdown, no prose, no code fences):",
  '  {',
  '    "verdicts": [ { "match": true|false, "confidence": 0..1, "reason": "<≤80 chars>" }, ... ],',
  '    "refinedQuery": "<a more precise search query, or empty string>"',
  '  }',
  "",
  "Rules:",
  "- verdicts MUST be an array with exactly the same number of objects as candidates, in candidate order.",
  "- match=true ONLY if it is literally the same product. Same printed name on packaging, same model name, same sculpt pose / character. Same series with a different name → match=false.",
  "- confidence: 0.9+ when matching product text/SKU is visible on packaging in BOTH images; 0.6-0.8 when the visual match is strong but no text confirms; <0.5 means uncertain.",
  "- reason: brief evidence — e.g. 'same product name visible on box', 'different sculpt: arm position differs', 'same series but different character'.",
  '- refinedQuery: when ANY verdict is match=false, READ THE PRINTED TEXT on the reference image (product name, SKU, edition number, artist signature) and synthesise a better Google search query. ALWAYS quote the exact product name (e.g. `"Majestic Perch" Ashley Wood UnderVerse`). Include any visible SKU. Append `official product photo`. The query MUST be different from the one that produced these candidates. Empty string ONLY when every verdict already matches OR you can read no useful identifying text on the reference.',
].join("\n");

const SKILL_VISION = {
  slug: "vision-compare-candidates",
  nameEn: "Vision Compare Candidates",
  nameZh: "视觉比对候选",
  icon: "visibility",
  descriptionEn:
    "Gemini 2.5 multi-image vision: image[0] is the user's reference, image[1..N] are SerpAPI candidates. Returns { verdicts: [...], refinedQuery: string } as JSON. Used by the picker DAG inside its 2-round search loop.",
  descriptionZh:
    "Gemini 2.5 多图视觉:图 0 为用户参考,图 1..N 为 SerpAPI 候选。返回 JSON { verdicts, refinedQuery }。供 picker DAG 的 2 轮搜索回路使用。",
  kind: "LLM_PROMPT" as const,
  handlerConfig: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    authEnv: "GEMINI_API_KEY",
    grounding: false,
    imagePathsField: "imageAbsPaths",
    maxTokens: 2048,
    responseFormat: "json",
    systemPrompt: VISION_SYSTEM_PROMPT,
    userTemplate:
      "REFERENCE IMAGE is image 1; CANDIDATE IMAGES are images 2..{{candidateCount}} from Google search \"{{currentQuery}}\". Output {{candidateCount}} verdicts in candidate order, plus a refinedQuery (read printed text off the reference; empty string if every verdict already matches).",
  } as Prisma.InputJsonValue,
  inputSchema: {
    type: "object",
    properties: {
      candidateCount: { type: "integer", description: "Number of candidate images being compared (1..N). Used in the prompt to ground the verdicts array length." },
      currentQuery: { type: "string", description: "The Google Images search query that produced these candidates." },
      imageAbsPaths: {
        type: "array",
        items: { type: "string" },
        description: "Absolute filesystem paths. First entry is the user's REFERENCE image; remaining entries are the SerpAPI candidates being judged.",
      },
    },
    required: ["candidateCount", "currentQuery", "imageAbsPaths"],
  } as Prisma.InputJsonValue,
};

// — — DAG — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
//
// Top-level (5 nodes):
//   mode (branch on useUserImage)
//     ├─ when "user" → userOnly (transform) → leaf
//     └─ when "net" → buildLoopInit (transform) → searchLoop (loop) → mergeFinal (transform) → leaf
//
// Loop body (7 nodes):
//   serp (skill 1) → serpFilter (transform) → forEachDl (forEach)
//   → prepVision (transform) → vision (skill 4) → applyVerdicts (transform)
//   → mergeIter (transform) — leaf, drives next iter / exitWhen.
//
// forEach body (3 nodes):
//   dl (skill 2) → save (skill 3) → mkCand (transform).

// JSONata expressions are formatted as multi-line template strings for
// readability — JSONata ignores whitespace.

const EXPR_USER_ONLY = `{
  "candidates": userCandidates ~> | $ | { "path": $.path, "source": $.source, "originalFilename": $.originalFilename, "sourceUrl": $.sourceUrl, "width": $.width, "height": $.height, "score": $.score, "deleted": $.deleted } |,
  "recommendedPrimaryPath": (userCandidates[deleted = false] ^(>score))[0].path,
  "networkFetchAttempted": false,
  "visionFilterApplied": false,
  "visionFilterRounds": 0,
  "visionFilterMatches": 0
}`;

const EXPR_BUILD_LOOP_INIT = `{
  "workspaceSlug": workspaceSlug,
  "referenceImageAbs": referenceImageAbs,
  "userCandidates": userCandidates,
  "accumulatedCandidates": userCandidates,
  "query": networkImageQuery,
  "originalQuery": networkImageQuery,
  "iterCount": 0,
  "visionFilterRounds": 0,
  "visionFilterMatches": 0,
  "visionFilterApplied": false,
  "networkFetchAttempted": false,
  "refinedQueryUsed": "",
  "refinedQueryNext": "<continue>"
}`;

const EXPR_SERP_FILTER = `(
  $watermark := /watermark|preview|sample|stocksy|gettyimages/i;
  $minWidth := 600;
  $maxItems := 3;
  {
    "items": (
      results.images_results
        [original and not($contains(original, $watermark)) and original_width >= $minWidth]
        ^(<original_width)
        [[0..($maxItems - 1)]]
        ~> | $ | {
          "url": original,
          "width": original_width,
          "height": original_height,
          "workspaceSlug": $$.workspaceSlug
        } |
    ),
    "workspaceSlug": workspaceSlug
  }
)`;

const EXPR_MK_CAND = `{
  "path": save.savedPath,
  "absPath": save.absPath,
  "source": "network",
  "originalFilename": ($substringAfter(item.url, "://") ~> $substringBefore("/")),
  "sourceUrl": item.url,
  "width": item.width,
  "height": item.height,
  "score": 80,
  "deleted": false
}`;

const EXPR_PREP_VISION = `{
  "imageAbsPaths": $append([ref], cands.absPath),
  "candidates": cands,
  "currentQuery": query,
  "candidateCount": $count(cands)
}`;

const EXPR_APPLY_VERDICTS = `{
  "thisRoundCandidates": (
    candidates#$i.{
      "path": $.path,
      "source": $.source,
      "originalFilename": $.originalFilename,
      "sourceUrl": $.sourceUrl,
      "width": $.width,
      "height": $.height,
      "score": ($.score + ($exists($$.vision.verdicts[$i].match) and $$.vision.verdicts[$i].match = true and $$.vision.verdicts[$i].confidence >= 0.6 ? 50 : -30)),
      "deleted": $not($exists($$.vision.verdicts[$i].match) and $$.vision.verdicts[$i].match = true and $$.vision.verdicts[$i].confidence >= 0.6)
    }
  ),
  "refinedQuery": ($exists(vision.refinedQuery) ? vision.refinedQuery : ""),
  "visionMatches": $count(vision.verdicts[match = true and confidence >= 0.6])
}`;

const EXPR_MERGE_ITER = `(
  $isFirstRound := prev.iterCount = 0;
  $shouldContinue := $isFirstRound and this.refinedQuery != "" and $lowercase(this.refinedQuery) != $lowercase(prev.originalQuery);
  {
    "workspaceSlug": prev.workspaceSlug,
    "referenceImageAbs": prev.referenceImageAbs,
    "userCandidates": prev.userCandidates,
    "accumulatedCandidates": $append(prev.accumulatedCandidates, this.thisRoundCandidates),
    "query": this.refinedQuery,
    "originalQuery": prev.originalQuery,
    "iterCount": prev.iterCount + 1,
    "visionFilterRounds": prev.visionFilterRounds + 1,
    "visionFilterMatches": prev.visionFilterMatches + this.visionMatches,
    "visionFilterApplied": true,
    "networkFetchAttempted": true,
    "refinedQueryUsed": ($shouldContinue ? this.refinedQuery : prev.refinedQueryUsed),
    "refinedQueryNext": ($shouldContinue ? "<continue>" : "")
  }
)`;

const EXPR_MERGE_FINAL = `{
  "candidates": accumulatedCandidates ~> | $ | {
    "path": $.path,
    "source": $.source,
    "originalFilename": $.originalFilename,
    "sourceUrl": $.sourceUrl,
    "width": $.width,
    "height": $.height,
    "score": $.score,
    "deleted": $.deleted
  } |,
  "recommendedPrimaryPath": (accumulatedCandidates[deleted = false] ^(>score))[0].path,
  "networkFetchAttempted": networkFetchAttempted,
  "visionFilterApplied": visionFilterApplied,
  "visionFilterMatches": visionFilterMatches,
  "visionFilterRounds": visionFilterRounds,
  "refinedQueryUsed": refinedQueryUsed
}`;

const FOREACH_BODY = {
  nodes: [
    {
      id: "dl",
      type: "skill" as const,
      slotIndex: 2,
      inputFrom: { merge: { url: "agent.input.item.url" } },
      position: { x: 60, y: 100 },
    },
    {
      id: "save",
      type: "persist" as const,
      inputFrom: {
        merge: {
          relicSlug: "agent.input.item.workspaceSlug",
          kind: "agent.input.item.kind",
          base64: "dl.output.base64",
          contentType: "dl.output.contentType",
        },
      },
      position: { x: 280, y: 100 },
    },
    {
      id: "mkCand",
      type: "transform" as const,
      inputFrom: {
        merge: {
          item: "agent.input.item",
          save: "save.output",
        },
      },
      expression: EXPR_MK_CAND,
      position: { x: 500, y: 100 },
    },
  ],
  edges: [
    { from: "dl", to: "save" },
    { from: "save", to: "mkCand" },
  ],
};

const LOOP_BODY = {
  nodes: [
    {
      id: "serp",
      type: "skill" as const,
      slotIndex: 1,
      inputFrom: { merge: { query: "agent.input.query" } },
      position: { x: 60, y: 200 },
    },
    {
      id: "serpFilter",
      type: "transform" as const,
      inputFrom: {
        merge: {
          results: "serp.output",
          workspaceSlug: "agent.input.workspaceSlug",
        },
      },
      expression: EXPR_SERP_FILTER,
      position: { x: 240, y: 200 },
    },
    {
      id: "forEachDl",
      type: "forEach" as const,
      inputFrom: {
        merge: {
          // forEach inputFrom must resolve to an array. Using sub-path
          // to pull out the items array; workspaceSlug is carried by
          // each item (set in serpFilter).
          items: "serpFilter.output.items",
        },
      },
      // the forEach handler expects an Array — pull the items field via
      // sub-path. Backbone's resolveRef supports subpath after .output;
      // here we rely on `inputFrom.merge` collapsing — but merge yields
      // an object not array. Switch to direct subpath ref:
      maxItems: 3,
      body: FOREACH_BODY,
      position: { x: 420, y: 200 },
    },
    {
      id: "prepVision",
      type: "transform" as const,
      inputFrom: {
        merge: {
          ref: "agent.input.referenceImageAbs",
          cands: "forEachDl.output",
          query: "agent.input.query",
        },
      },
      expression: EXPR_PREP_VISION,
      position: { x: 600, y: 200 },
    },
    {
      id: "vision",
      type: "skill" as const,
      slotIndex: 4,
      inputFrom: "prepVision.output",
      position: { x: 780, y: 200 },
    },
    {
      id: "applyVerdicts",
      type: "transform" as const,
      inputFrom: {
        merge: {
          candidates: "prepVision.output.candidates",
          vision: "vision.output",
        },
      },
      expression: EXPR_APPLY_VERDICTS,
      position: { x: 960, y: 200 },
    },
    {
      id: "mergeIter",
      type: "transform" as const,
      inputFrom: {
        merge: {
          prev: "agent.input",
          this: "applyVerdicts.output",
        },
      },
      expression: EXPR_MERGE_ITER,
      position: { x: 1140, y: 200 },
    },
  ],
  edges: [
    { from: "serp", to: "serpFilter" },
    { from: "serpFilter", to: "forEachDl" },
    { from: "forEachDl", to: "prepVision" },
    { from: "prepVision", to: "vision" },
    { from: "vision", to: "applyVerdicts" },
    { from: "applyVerdicts", to: "mergeIter" },
  ],
};

// Patch forEachDl inputFrom: the loop body has a transform that produces
// `{ items: [...], workspaceSlug }`. forEach needs the array directly.
// Use the direct-subpath form on inputFrom (backbone supports
// `<nodeId>.output.<subpath>`).
LOOP_BODY.nodes[2].inputFrom = "serpFilter.output.items" as never;
// Also each item needs a `kind` field for save-asset; serpFilter doesn't
// add it so we patch by adjusting the mkCand input merge to inject it.
// Actually forEach body's `save` step reads agent.input.item.kind which
// we never set — patch FOREACH_BODY's save bodyTemplate to default kind.
// Simpler path: hard-code kind in the save skill's bodyTemplate by
// shadowing the input.kind field with a constant via a per-iter
// transform. To avoid a fourth body node, hard-code "cand-net" as the
// item.kind via a tiny serpFilter post-process: each item gets a `kind`
// alongside workspaceSlug. Simpler still: change save skill's bodyTemplate
// to use a literal `"cand-net"`. Done above (see SKILL_SAVE_NET — leaving
// {{kind}} in the template; we set it via the merge in the save node).
// Patch FOREACH_BODY save inputFrom to include a literal kind:
{
  const saveNode = FOREACH_BODY.nodes[1] as { inputFrom: unknown };
  saveNode.inputFrom = {
    merge: {
      relicSlug: "agent.input.item.workspaceSlug",
      // Backbone merge values must be source refs (strings); we can't
      // inject literals. Workaround: have the forEach driver (serpFilter)
      // set item.kind so this merge can pull it.
      kind: "agent.input.item.kind",
      base64: "dl.output.base64",
      contentType: "dl.output.contentType",
    },
  };
}

const TOP_LEVEL_PIPELINE = {
  version: 2 as const,
  nodes: [
    {
      id: "mode",
      type: "branch" as const,
      inputFrom: "agent.input",
      cases: [
        { path: "useUserImage", op: "eq" as const, value: true, label: "user" },
        { path: "useUserImage", op: "eq" as const, value: false, label: "net" },
      ],
      defaultLabel: "user",
      position: { x: 60, y: 200 },
    },
    {
      id: "userOnly",
      type: "transform" as const,
      inputFrom: "agent.input",
      expression: EXPR_USER_ONLY,
      position: { x: 280, y: 80 },
    },
    {
      id: "buildLoopInit",
      type: "transform" as const,
      inputFrom: "agent.input",
      expression: EXPR_BUILD_LOOP_INIT,
      position: { x: 280, y: 320 },
    },
    {
      id: "searchLoop",
      type: "loop" as const,
      inputFrom: "buildLoopInit.output",
      maxIterations: 2,
      exitWhen: [
        {
          path: "refinedQueryNext",
          op: "eq" as const,
          value: "",
          label: "exit",
        },
      ],
      aggregate: "last" as const,
      body: LOOP_BODY,
      position: { x: 500, y: 320 },
    },
    {
      id: "mergeFinal",
      type: "transform" as const,
      inputFrom: "searchLoop.output",
      expression: EXPR_MERGE_FINAL,
      position: { x: 720, y: 320 },
    },
  ],
  edges: [
    { from: "mode", to: "userOnly", when: "user" },
    { from: "mode", to: "buildLoopInit", when: "net" },
    { from: "buildLoopInit", to: "searchLoop" },
    { from: "searchLoop", to: "mergeFinal" },
  ],
};

// Need item.kind on each forEach iteration item; serpFilter must put it
// there. Patch the expression to add `"kind": "cand-net"` per item.
// (Done in EXPR_SERP_FILTER — but didn't add kind. Patch now.)
// We update the constant by replacing the existing projection literal:
// rather than re-derive the string, set a corrected version explicitly.
const EXPR_SERP_FILTER_WITH_KIND = `(
  $watermark := /watermark|preview|sample|stocksy|gettyimages/i;
  $minWidth := 600;
  $maxItems := 3;
  {
    "items": (
      results.images_results
        [original and not($contains(original, $watermark)) and original_width >= $minWidth]
        ^(<original_width)
        [[0..($maxItems - 1)]]
        ~> | $ | {
          "url": original,
          "width": original_width,
          "height": original_height,
          "workspaceSlug": $$.workspaceSlug,
          "kind": "cand-net"
        } |
    ),
    "workspaceSlug": workspaceSlug
  }
)`;

(LOOP_BODY.nodes[1] as { expression: string }).expression = EXPR_SERP_FILTER_WITH_KIND;

// 2026-05-12 — inputMap retired. ctx → agent.input is owned by
// scene.prepareAgentInput in lib/relics/scenes.ts (relicSmartImagePickScene).

// 2026-05-11: outputMap dropped — both branch leaves (userOnly +
// mergeFinal) already produce scene-shape `{ candidates,
// recommendedPrimaryPath, ... }` directly; dispatch returns the topo-last
// live leaf's output and scene.outputSchema validates it.

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(12).toString("hex").slice(0, 21 - ts.length);
  return `c${ts}${rand}`.padEnd(25, "0").slice(0, 25);
}

type SkillSpec =
  | typeof SKILL_SERP
  | typeof SKILL_DOWNLOAD
  | typeof SKILL_VISION;

async function ensureSkill(prisma: PrismaClient, spec: SkillSpec): Promise<string> {
  const existing = await prisma.skill.findUnique({ where: { slug: spec.slug } });
  if (existing) {
    // Heal — overwrite handlerConfig so re-runs in legacy environments
    // pick up the latest defaults / tunings.
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
    console.log(`[migrate-picker-forge] skill "${spec.slug}" exists (${existing.id}); healed config`);
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
  console.log(`[migrate-picker-forge] created skill ${spec.slug} (${created.id})`);
  return created.id;
}

async function ensureForgeAgent(
  prisma: PrismaClient,
  skillIds: { serp: string; download: string; vision: string },
): Promise<string> {
  const existing = await prisma.agent.findUnique({ where: { codename: NEW_AGENT_CODENAME } });
  if (existing) {
    await prisma.agent.update({
      where: { id: existing.id },
      data: { pipelineConfig: TOP_LEVEL_PIPELINE as unknown as Prisma.InputJsonValue },
    });
    for (const [slotIndex, skillId] of [
      [1, skillIds.serp],
      [2, skillIds.download],
      [4, skillIds.vision],
    ] as const) {
      const eq = await prisma.agentSkillEquip.findFirst({
        where: { agentId: existing.id, slotIndex },
      });
      if (!eq) {
        await prisma.agentSkillEquip.create({
          data: { agentId: existing.id, skillId, slotIndex, unlocked: true },
        });
        console.log(`[migrate-picker-forge] re-equipped ${NEW_AGENT_CODENAME} slot ${slotIndex}`);
      } else if (eq.skillId !== skillId) {
        await prisma.agentSkillEquip.update({
          where: { id: eq.id },
          data: { skillId },
        });
        console.log(`[migrate-picker-forge] swapped slot ${slotIndex} skill on ${NEW_AGENT_CODENAME}`);
      }
    }
    console.log(`[migrate-picker-forge] agent ${NEW_AGENT_CODENAME} exists (${existing.id}); healed shape`);
    return existing.id;
  }

  const id = genCuid();
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        id,
        codename: NEW_AGENT_CODENAME,
        codenameZh: "选图熔炉",
        nameEn: "Picker Forge",
        nameZh: "选图熔炉",
        mode: "MECHANICAL",
        status: "DEPLOYED",
        avatarUrl: "/images/agent-control/avatars/placeholder.svg",
        capabilities: ["image-pick"],
        pipelineConfig: TOP_LEVEL_PIPELINE as unknown as Prisma.InputJsonValue,
        deployedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.agentSkillEquip.createMany({
      data: [
        { agentId: agent.id, skillId: skillIds.serp, slotIndex: 1, unlocked: true },
        { agentId: agent.id, skillId: skillIds.download, slotIndex: 2, unlocked: true },
        { agentId: agent.id, skillId: skillIds.vision, slotIndex: 4, unlocked: true },
      ],
    });
    return agent;
  });
  console.log(`[migrate-picker-forge] created agent ${NEW_AGENT_CODENAME} (${result.id}) + 3 equips (slot 3 empty — persist primitive)`);
  return result.id;
}

async function bindScene(prisma: PrismaClient, forgeId: string): Promise<void> {
  const sceneKey = "relic.smart-image-pick";
  const existing = await prisma.sceneBinding.findUnique({ where: { sceneKey } });
  if (existing) {
    await prisma.sceneBinding.update({
      where: { sceneKey },
      data: {
        agentId: forgeId,
        enabled: true,
        notes: "PICKER-FORGE-001: backbone loop+forEach+transform decomposition of the legacy INTERNAL handler.",
      },
    });
    console.log(`[migrate-picker-forge] healed binding for ${sceneKey}`);
    return;
  }
  await prisma.sceneBinding.create({
    data: {
      sceneKey,
      agentId: forgeId,
      enabled: true,
      notes: "PICKER-FORGE-001: backbone loop+forEach+transform decomposition of the legacy INTERNAL handler.",
    },
  });
  console.log(`[migrate-picker-forge] bound ${sceneKey} → PICKER-FORGE-001`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SceneBinding') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-picker-forge] SceneBinding table absent — skip (run earlier migrations first)");
      return;
    }

    const serpId = await ensureSkill(prisma, SKILL_SERP);
    const downloadId = await ensureSkill(prisma, SKILL_DOWNLOAD);
    const visionId = await ensureSkill(prisma, SKILL_VISION);

    const forgeId = await ensureForgeAgent(prisma, {
      serp: serpId,
      download: downloadId,
      vision: visionId,
    });
    await bindScene(prisma, forgeId);

    console.log("[migrate-picker-forge] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-picker-forge] failed:", e);
  process.exit(1);
});
