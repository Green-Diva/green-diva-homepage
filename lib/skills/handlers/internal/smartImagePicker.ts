// INTERNAL handler: relic-smart-image-pick
//
// Replaces the v1 relicImagePick (which just picked the largest user image).
// Now produces a CANDIDATE SET — every user image is registered, plus optional
// network images fetched via SerpAPI when Gemini Researcher decided the relic
// is a mass-produced item with cleaner stock photography available.
//
// Vision second-pass + refinement loop: after SerpAPI returns candidates
// we feed (user reference image + each candidate) to Gemini Vision and ask
// "is this the SAME PRODUCT?" — defending against the common SerpAPI
// failure mode of returning visually similar items from the same
// brand/series. Candidates the model rejects are kept (admin can restore)
// but flagged deleted=true so the default review UI shows only verified
// matches.
//
// Two-round search: when round 1 has unmatched candidates, the vision
// model also returns a `refinedQuery` — a more precise search query
// synthesised from text it could read off the user's reference image
// (product name in quotes, SKU, edition number). If the refined query
// differs from the original, we run a second SerpAPI round and apply the
// same vision filter to those candidates. Hard cap: TWO rounds, never
// three — admins can manually re-run if both rounds miss.
//
// The candidate set is what admin sees in the review UI (RelicForm
// CandidateImageGallery). They can toggle delete + change which one is the
// primary. Recommended primary on output is just AI's first guess.
//
// handlerConfig (everything optional — falls back to bundled defaults):
//   {
//     searchAuthEnv?: string,           // default "SERPAPI_KEY"
//     visionAuthEnv?: string,           // default "GEMINI_API_KEY"
//     visionModel?: string,             // default "gemini-2.5-flash"
//     enableVisionFilter?: boolean,     // default true
//     maxNetworkFetch?: number,         // default 3
//     maxImageBytes?: number,           // per-image cap, default 10MB
//
//     // — Phase 2.4.3 admin-tunable knobs —
//
//     serpUrl?: string,                 // default "https://serpapi.com/search.json"
//     serpEngine?: string,              // default "google_images"
//     serpMinWidth?: number,            // default 600 — drops thumbnail-grade results
//     visionMinConfidence?: number,     // default 0.6 — vision verdict threshold
//     visionMatchBoost?: number,        // default 50 — score added when vision says match
//     visionMissPenalty?: number,       // default 30 — score subtracted when vision rejects
//     watermarkPattern?: string,        // default "watermark|preview|sample|stocksy|gettyimages"
//                                       //   case-insensitive RegExp source applied to result URL
//     prompts?: {
//       visionFilterWithRefine?: string,    // overrides DEFAULT_VISION_PROMPT_WITH_REFINE
//       visionFilterNoRefine?: string,      // overrides DEFAULT_VISION_PROMPT_NO_REFINE
//     },
//   }
//
// Input:
//   { relicSlug, imageAbsPaths: string[], useUserImage: boolean,
//     networkImageQuery?: string } | { _dryRun: true }
//
// Output:
//   { candidates: CandidateImage[], recommendedPrimaryPath: string,
//     networkFetchAttempted: boolean, networkFetchFailureReason?: string,
//     visionFilterApplied?: boolean, visionFilterMatches?: number,
//     visionFilterRounds?: number, refinedQueryUsed?: string }

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { HandlerError, type SkillHandler } from "../../types";

// Accepts both Relic slugs ("vault-001-abcdef") and RelicDraft workspace
// slugs ("_drafts/<cuid>") — picker writes candidates to the same
// derived/ folder under either prefix.
const SAFE_SLUG_RE = /^(_drafts\/)?[a-zA-Z0-9_-]+$/;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif"]);

// Defence-in-depth against macOS / Windows sidecar files. Even though
// extractZip filters these, callers may feed paths from elsewhere (e.g.
// admin re-upload, manual test-invoke).
function isSidecarBasename(p: string): boolean {
  const base = path.basename(p);
  return base.startsWith("._") || base === ".DS_Store" || base === "Thumbs.db";
}
const DEFAULT_WATERMARK_PATTERN = "watermark|preview|sample|stocksy|gettyimages";
const DEFAULT_MAX_NET = 3;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_VISION_MODEL = "gemini-2.5-flash";
const DEFAULT_VISION_MIN_CONFIDENCE = 0.6;
const DEFAULT_VISION_MATCH_BOOST = 50;
const DEFAULT_VISION_MISS_PENALTY = 30;
const DEFAULT_SERP_URL = "https://serpapi.com/search.json";
const DEFAULT_SERP_ENGINE = "google_images";
const DEFAULT_SERP_MIN_WIDTH = 600;
const VISION_MAX_REF_BYTES = 5 * 1024 * 1024;

// — — DEFAULT prompts — — — — — — — — — — — — — — — — — — — — — — — — —
// The vision-filter system prompt has two variants depending on whether
// the round should also synthesise a refinedQuery. Admin overrides via
// handlerConfig.prompts.{visionFilterWithRefine|visionFilterNoRefine}.

export const DEFAULT_VISION_PROMPT_WITH_REFINE = [
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
  "- refinedQuery: when ANY verdict is match=false, READ THE PRINTED TEXT on the reference image (product name, SKU, edition number, artist signature) and synthesise a better Google search query. ALWAYS quote the exact product name (e.g. `\"Majestic Perch\" Ashley Wood UnderVerse`). Include any visible SKU. Append `official product photo`. The query MUST be different from the one that produced these candidates. Empty string ONLY when every verdict already matches OR you can read no useful identifying text on the reference.",
].join("\n");

export const DEFAULT_VISION_PROMPT_NO_REFINE = [
  "You compare a user's reference photo against candidate images to identify the EXACT same product (not just similar items from the same brand or series).",
  "",
  "The FIRST image is the REFERENCE — what the user actually has. The remaining images are CANDIDATES from a Google Image search.",
  "",
  "For each candidate, decide whether it depicts the SAME PHYSICAL PRODUCT as the reference. Manufacturers ship many similar-looking products in the same series — identical-looking sculpts and packaging styles are common between different SKUs. A different SKU = NOT a match, even if visually close.",
  "",
  "Output STRICT JSON in this shape (no markdown, no prose, no code fences):",
  '  {',
  '    "verdicts": [ { "match": true|false, "confidence": 0..1, "reason": "<≤80 chars>" }, ... ],',
  '    "refinedQuery": ""',
  '  }',
  "",
  "Rules:",
  "- verdicts MUST be an array with exactly the same number of objects as candidates, in candidate order.",
  "- match=true ONLY if it is literally the same product. Same printed name on packaging, same model name, same sculpt pose / character. Same series with a different name → match=false.",
  "- confidence: 0.9+ when matching product text/SKU is visible on packaging in BOTH images; 0.6-0.8 when the visual match is strong but no text confirms; <0.5 means uncertain.",
  "- reason: brief evidence — e.g. 'same product name visible on box', 'different sculpt: arm position differs', 'same series but different character'.",
  "- refinedQuery: leave as empty string; we are not searching again.",
].join("\n");

type ResolvedKnobs = {
  serpUrl: string;
  serpEngine: string;
  serpMinWidth: number;
  watermarkPattern: RegExp;
  visionMinConfidence: number;
  visionMatchBoost: number;
  visionMissPenalty: number;
  visionPromptWithRefine: string;
  visionPromptNoRefine: string;
};

function resolveKnobs(config: Record<string, unknown>): ResolvedKnobs {
  const promptsObj =
    config.prompts && typeof config.prompts === "object" && !Array.isArray(config.prompts)
      ? (config.prompts as Record<string, unknown>)
      : {};
  const pickStr = (raw: unknown, fb: string): string =>
    typeof raw === "string" && raw.trim().length > 0 ? raw : fb;
  const pickNum = (raw: unknown, fb: number): number =>
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : fb;
  const watermarkSource = pickStr(config.watermarkPattern, DEFAULT_WATERMARK_PATTERN);
  let watermarkPattern: RegExp;
  try {
    watermarkPattern = new RegExp(watermarkSource, "i");
  } catch (e) {
    console.warn(
      `[smart-image-pick] invalid watermarkPattern "${watermarkSource}", using default:`,
      e,
    );
    watermarkPattern = new RegExp(DEFAULT_WATERMARK_PATTERN, "i");
  }
  return {
    serpUrl: pickStr(config.serpUrl, DEFAULT_SERP_URL),
    serpEngine: pickStr(config.serpEngine, DEFAULT_SERP_ENGINE),
    serpMinWidth: pickNum(config.serpMinWidth, DEFAULT_SERP_MIN_WIDTH),
    watermarkPattern,
    visionMinConfidence: pickNum(config.visionMinConfidence, DEFAULT_VISION_MIN_CONFIDENCE),
    visionMatchBoost: pickNum(config.visionMatchBoost, DEFAULT_VISION_MATCH_BOOST),
    visionMissPenalty: pickNum(config.visionMissPenalty, DEFAULT_VISION_MISS_PENALTY),
    visionPromptWithRefine: pickStr(promptsObj.visionFilterWithRefine, DEFAULT_VISION_PROMPT_WITH_REFINE),
    visionPromptNoRefine: pickStr(promptsObj.visionFilterNoRefine, DEFAULT_VISION_PROMPT_NO_REFINE),
  };
}
const VISION_IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type Candidate = {
  path: string;
  source: "user" | "network";
  originalFilename?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  score: number;
  deleted: boolean;
};

type SerpImageResult = {
  position?: number;
  thumbnail?: string;
  original?: string;
  original_width?: number;
  original_height?: number;
  source?: string;
  link?: string;
};

type SerpResponse = {
  images_results?: SerpImageResult[];
  error?: string;
};

async function statSize(abs: string): Promise<number> {
  try {
    return (await fs.stat(abs)).size;
  } catch {
    return 0;
  }
}

type VisionVerdict = {
  match: boolean;
  confidence: number;
  reason: string;
};

type VisionResult = {
  verdicts: VisionVerdict[];
  // When the model thinks the current SerpAPI results don't fully match
  // (i.e. some verdicts are match=false), it can suggest a more precise
  // search query for the next round — typically a quoted product name /
  // SKU it could read off the reference image. Empty string when no
  // refinement is warranted (e.g. all candidates already match).
  refinedQuery: string;
};

// Picks the largest (by file size) user image to use as the vision-filter
// reference. Larger usually means more detail / readable text on packaging.
async function pickLargestImage(absPaths: string[]): Promise<string> {
  let bestAbs = absPaths[0];
  let bestSize = 0;
  for (const a of absPaths) {
    if (isSidecarBasename(a)) continue;
    const ext = path.extname(a).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    try {
      const stat = await fs.stat(a);
      if (stat.size > bestSize) {
        bestSize = stat.size;
        bestAbs = a;
      }
    } catch {
      // skip
    }
  }
  return bestAbs;
}

async function loadInlinePart(abs: string, maxBytes: number): Promise<Part | null> {
  const ext = path.extname(abs).toLowerCase();
  const mime = VISION_IMAGE_MIME[ext];
  if (!mime) return null;
  try {
    const stat = await fs.stat(abs);
    if (stat.size > maxBytes) return null;
    const buf = await fs.readFile(abs);
    return { inlineData: { mimeType: mime, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

function stripCodeFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : t;
}

// Compares each candidate image against the user's reference photo and
// returns a verdict per candidate (in order) PLUS a refinedQuery the model
// suggests for a follow-up SerpAPI round if any candidate didn't match.
//
// A null return means the vision pass was skipped or failed — caller should
// leave candidates unfiltered in that case rather than dropping them.
async function visionCompareCandidates(opts: {
  apiKey: string;
  model: string;
  referenceAbs: string;
  candidateAbsPaths: string[];
  // The query that produced these candidates. Passed in so the model can
  // suggest a *different* query rather than echoing the same one back.
  currentQuery: string;
  // When true, the prompt asks for a refinedQuery on unmatched results.
  // When false (round 2), the field is ignored (we're not searching again).
  askForRefinedQuery: boolean;
  // Phase 2.4.3: prompts come from caller-resolved handlerConfig so admin
  // can edit them without commit. Both variants supplied; we pick by
  // askForRefinedQuery.
  promptWithRefine: string;
  promptNoRefine: string;
}): Promise<VisionResult | null> {
  const refPart = await loadInlinePart(opts.referenceAbs, VISION_MAX_REF_BYTES);
  if (!refPart) return null;

  const candParts: Part[] = [];
  for (const c of opts.candidateAbsPaths) {
    const p = await loadInlinePart(c, VISION_MAX_REF_BYTES);
    if (!p) return null;
    candParts.push(p);
  }
  if (candParts.length === 0) return { verdicts: [], refinedQuery: "" };

  const sys = opts.askForRefinedQuery ? opts.promptWithRefine : opts.promptNoRefine;

  const user: Part[] = [
    { text: "REFERENCE IMAGE (image 1, the user's photo):" },
    refPart,
    { text: `CANDIDATE IMAGES (images 2..${candParts.length + 1}, from Google search "${opts.currentQuery}"):` },
    ...candParts,
    {
      text: `Output the JSON object now. ${candParts.length} verdict${candParts.length === 1 ? "" : "s"}, in candidate order.`,
    },
  ];

  try {
    const genAI = new GoogleGenerativeAI(opts.apiKey);
    const model = genAI.getGenerativeModel({
      model: opts.model,
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1024 },
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: user }],
      systemInstruction: sys,
    });
    const text = result.response.text();
    const cleaned = stripCodeFence(text);
    const parsed: unknown = JSON.parse(cleaned);
    if (!isObject(parsed) || !Array.isArray(parsed.verdicts) || parsed.verdicts.length !== candParts.length) {
      console.warn("[smart-image-pick] vision filter shape mismatch", {
        got: isObject(parsed) && Array.isArray(parsed.verdicts) ? parsed.verdicts.length : null,
        expected: candParts.length,
      });
      return null;
    }
    const verdicts = parsed.verdicts.map((v): VisionVerdict => {
      const obj = isObject(v) ? v : {};
      return {
        match: obj.match === true,
        confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
        reason: typeof obj.reason === "string" ? obj.reason.slice(0, 200) : "",
      };
    });
    const refinedQuery =
      typeof parsed.refinedQuery === "string" ? parsed.refinedQuery.trim().slice(0, 200) : "";
    return { verdicts, refinedQuery };
  } catch (e) {
    console.warn("[smart-image-pick] vision filter threw", e);
    return null;
  }
}

// Single SerpAPI search → download → vision-filter pass. Pushes new
// candidates into the shared `candidates` array and applies the vision
// verdict to them in place (matched → score boost, unmatched → deleted).
// Returns metadata about the round so the caller can decide whether to do
// a second pass.
async function runSearchRound(opts: {
  query: string;
  netSuffix: string; // "net" / "net2" — keeps round 2 file names distinct
  ts: number;
  slug: string;
  derivedDir: string;
  candidates: Candidate[];
  serpKey: string | null;
  serpEnvName: string;
  maxNetworkFetch: number;
  maxImageBytes: number;
  visionKey: string | null;
  visionModel: string;
  visionEnabled: boolean;
  askForRefinedQuery: boolean;
  referenceAbs: string | null;
  // Phase 2.4.3 admin-tunable knobs (resolved by caller from handlerConfig).
  knobs: ResolvedKnobs;
}): Promise<{
  attempted: boolean;
  newCandidatesCount: number;
  failureReason?: string;
  visionApplied: boolean;
  visionMatches: number;
  visionTotal: number;
  refinedQuery: string;
}> {
  const fetched: Array<{ abs: string; idx: number }> = [];
  let failureReason: string | undefined;
  let attempted = false;

  if (!opts.serpKey) {
    return {
      attempted: false,
      newCandidatesCount: 0,
      failureReason: `env "${opts.serpEnvName}" not set`,
      visionApplied: false,
      visionMatches: 0,
      visionTotal: 0,
      refinedQuery: "",
    };
  }

  attempted = true;
  try {
    const url = new URL(opts.knobs.serpUrl);
    url.searchParams.set("engine", opts.knobs.serpEngine);
    url.searchParams.set("q", opts.query);
    url.searchParams.set("api_key", opts.serpKey);
    url.searchParams.set("ijn", "0");
    const sres = await fetch(url.toString());
    if (!sres.ok) {
      failureReason = `SerpAPI HTTP ${sres.status}`;
    } else {
      const sjson = (await sres.json()) as SerpResponse;
      if (sjson.error) {
        failureReason = `SerpAPI: ${sjson.error}`;
      } else {
        const results = (sjson.images_results ?? [])
          .filter((r) => typeof r.original === "string" && !opts.knobs.watermarkPattern.test(r.original ?? ""))
          .filter((r) => typeof r.original_width === "number" && (r.original_width ?? 0) >= opts.knobs.serpMinWidth)
          .sort(
            (a, b) =>
              (b.original_width ?? 0) * (b.original_height ?? 0) -
              (a.original_width ?? 0) * (a.original_height ?? 0),
          )
          .slice(0, opts.maxNetworkFetch);
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const origUrl = r.original!;
          try {
            const dlRes = await fetch(origUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; GreenDiva/1.0)" },
            });
            if (!dlRes.ok) continue;
            const cl = Number(dlRes.headers.get("content-length") ?? 0);
            if (cl > opts.maxImageBytes) continue;
            const buf = Buffer.from(await dlRes.arrayBuffer());
            if (buf.length > opts.maxImageBytes) continue;
            const ct = dlRes.headers.get("content-type") ?? "";
            let ext = ".jpg";
            if (ct.includes("png")) ext = ".png";
            else if (ct.includes("webp")) ext = ".webp";
            else if (ct.includes("gif")) ext = ".gif";
            const dstName = `cand-${opts.ts}-${opts.netSuffix}-${i}${ext}`;
            const dstAbs = path.join(opts.derivedDir, dstName);
            await fs.writeFile(dstAbs, buf);
            const idx = opts.candidates.push({
              path: `/${opts.slug}/derived/${dstName}`,
              source: "network",
              originalFilename: new URL(origUrl).hostname,
              sourceUrl: origUrl,
              width: r.original_width,
              height: r.original_height,
              score: 80 + Math.min(20, Math.round(((r.original_width ?? 0) * (r.original_height ?? 0)) / 1_000_000)),
              deleted: false,
            }) - 1;
            fetched.push({ abs: dstAbs, idx });
          } catch (e) {
            failureReason ??= `download failed: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      }
    }
  } catch (e) {
    failureReason = `SerpAPI fetch threw: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Apply vision filter to the candidates this round just pushed.
  let visionApplied = false;
  let visionMatches = 0;
  let refinedQuery = "";
  if (
    opts.visionEnabled &&
    opts.visionKey &&
    opts.referenceAbs &&
    fetched.length > 0
  ) {
    const result = await visionCompareCandidates({
      apiKey: opts.visionKey,
      model: opts.visionModel,
      referenceAbs: opts.referenceAbs,
      candidateAbsPaths: fetched.map((n) => n.abs),
      currentQuery: opts.query,
      askForRefinedQuery: opts.askForRefinedQuery,
      promptWithRefine: opts.knobs.visionPromptWithRefine,
      promptNoRefine: opts.knobs.visionPromptNoRefine,
    });
    if (result) {
      visionApplied = true;
      refinedQuery = result.refinedQuery;
      for (let i = 0; i < fetched.length; i++) {
        const v = result.verdicts[i];
        if (!v) continue;
        const c = opts.candidates[fetched[i].idx];
        if (!c) continue;
        const accepted = v.match && v.confidence >= opts.knobs.visionMinConfidence;
        if (accepted) {
          visionMatches += 1;
          // Boost matched candidates so the recommended primary lands on
          // a verified network image, not a user snapshot.
          c.score += opts.knobs.visionMatchBoost;
        } else {
          // Hide by default; admin can restore from the "deleted" panel
          // if the model misjudged.
          c.deleted = true;
          c.score = Math.max(0, c.score - opts.knobs.visionMissPenalty);
        }
      }
    }
  } else if (opts.visionEnabled && !opts.visionKey) {
    console.warn("[smart-image-pick] vision filter skipped: vision API key not set");
  }

  return {
    attempted,
    newCandidatesCount: fetched.length,
    failureReason,
    visionApplied,
    visionMatches,
    visionTotal: fetched.length,
    refinedQuery,
  };
}

// Naive image-dimensions probe: read the file and parse PNG/JPEG headers.
// Avoids pulling in `sharp` for a single use — the score doesn't need to
// be exact, just monotonic. Returns undefined when format isn't recognised.
async function probeDimensions(abs: string): Promise<{ width: number; height: number } | undefined> {
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(abs, "r");
    const buf = Buffer.alloc(64);
    await fh.read(buf, 0, 64, 0);
    // PNG: bytes 16-19 width BE, 20-23 height BE
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // JPEG: scan SOF marker — too involved to do in 64 bytes; fall back to file-size heuristic.
    return undefined;
  } catch {
    return undefined;
  } finally {
    if (fh) await fh.close();
  }
}

export const smartImagePicker: SkillHandler = async (input, config) => {
  const maxNetworkFetch =
    typeof config.maxNetworkFetch === "number" ? config.maxNetworkFetch : DEFAULT_MAX_NET;
  const maxImageBytes =
    typeof config.maxImageBytes === "number" ? config.maxImageBytes : DEFAULT_MAX_BYTES;
  const envName =
    typeof config.searchAuthEnv === "string" && config.searchAuthEnv
      ? config.searchAuthEnv
      : "SERPAPI_KEY";
  const visionAuthEnvName =
    typeof config.visionAuthEnv === "string" && config.visionAuthEnv
      ? config.visionAuthEnv
      : "GEMINI_API_KEY";
  const visionModel =
    typeof config.visionModel === "string" && config.visionModel
      ? config.visionModel
      : DEFAULT_VISION_MODEL;
  const enableVisionFilter = config.enableVisionFilter !== false; // default true
  const knobs = resolveKnobs(config);

  if (!isObject(input)) {
    throw new HandlerError("relic-smart-image-pick: input must be an object", "INVALID_CONFIG");
  }
  if (input._dryRun === true) {
    return {
      candidates: [
        {
          path: "/_dryrun/derived/cand-fake-1.jpg",
          source: "user",
          originalFilename: "IMG_3751.jpeg",
          width: 4032,
          height: 3024,
          score: 100,
          deleted: false,
        },
      ],
      recommendedPrimaryPath: "/_dryrun/derived/cand-fake-1.jpg",
      networkFetchAttempted: false,
    };
  }

  const slug = typeof input.relicSlug === "string" ? input.relicSlug : null;
  if (!slug || !SAFE_SLUG_RE.test(slug)) {
    throw new HandlerError("relic-smart-image-pick: invalid relicSlug", "INVALID_CONFIG");
  }
  const imageAbsPaths = Array.isArray(input.imageAbsPaths)
    ? (input.imageAbsPaths as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  const useUserImage = input.useUserImage !== false; // default true
  const networkImageQuery =
    typeof input.networkImageQuery === "string" ? input.networkImageQuery : null;

  if (imageAbsPaths.length === 0 && useUserImage) {
    throw new HandlerError(
      "relic-smart-image-pick: no user images and useUserImage=true",
      "INVALID_CONFIG",
    );
  }

  const dirs = pipelineDirsForSlug(slug);
  await fs.mkdir(dirs.derived, { recursive: true });
  const ts = Date.now();
  const candidates: Candidate[] = [];

  // 1. Always register all user images.
  for (let i = 0; i < imageAbsPaths.length; i++) {
    const src = imageAbsPaths[i];
    if (isSidecarBasename(src)) continue;
    const ext = path.extname(src).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    const dstName = `cand-${ts}-${i}${ext}`;
    const dstAbs = path.join(dirs.derived, dstName);
    try {
      await fs.copyFile(src, dstAbs);
    } catch {
      continue;
    }
    const size = await statSize(dstAbs);
    const dims = await probeDimensions(dstAbs);
    candidates.push({
      path: `/${slug}/derived/${dstName}`,
      source: "user",
      originalFilename: path.basename(src),
      width: dims?.width,
      height: dims?.height,
      // Score: prefer larger images. User-source bonus + size in MB.
      score: 50 + Math.round(size / 1024 / 1024),
      deleted: false,
    });
  }

  // 2. Network image search — up to two rounds.
  //
  //    Round 1 uses Researcher's networkImageQuery. After candidates are
  //    downloaded we run vision filter (image-by-image comparison against
  //    the user's reference photo). The vision call also returns a
  //    refinedQuery — Gemini's suggestion for a more precise query based on
  //    text it could read off the reference image (product name / SKU /
  //    edition). If round 1 had any unmatched candidates AND the model
  //    suggested a different query, we run round 2 with that query and
  //    apply vision filter again. Hard cap: TWO rounds, never three.
  let networkFetchAttempted = false;
  let networkFetchFailureReason: string | undefined;
  let visionFilterApplied = false;
  let visionFilterMatches = 0;
  let visionFilterRounds = 0;
  let usedRefinedQuery: string | undefined;

  if (!useUserImage && networkImageQuery) {
    const serpKey = process.env[envName];
    const visionKey = process.env[visionAuthEnvName];
    const refAbs =
      enableVisionFilter && visionKey && imageAbsPaths.length > 0
        ? await pickLargestImage(imageAbsPaths)
        : null;

    const round1 = await runSearchRound({
      query: networkImageQuery,
      netSuffix: "net",
      ts,
      slug,
      derivedDir: dirs.derived,
      candidates,
      serpKey: serpKey ?? null,
      serpEnvName: envName,
      maxNetworkFetch,
      maxImageBytes,
      visionKey: visionKey ?? null,
      visionModel,
      visionEnabled: enableVisionFilter,
      askForRefinedQuery: true,
      referenceAbs: refAbs,
      knobs,
    });
    if (round1.attempted) networkFetchAttempted = true;
    if (round1.failureReason) networkFetchFailureReason = round1.failureReason;
    if (round1.visionApplied) {
      visionFilterApplied = true;
      visionFilterMatches += round1.visionMatches;
      visionFilterRounds = 1;
    }

    // Round 2 trigger: round 1 produced candidates, vision filter ran, some
    // were unmatched, and Gemini gave us a different query to try.
    const round2Eligible =
      round1.visionApplied &&
      round1.visionTotal > round1.visionMatches &&
      round1.refinedQuery !== "" &&
      round1.refinedQuery.toLowerCase() !== networkImageQuery.toLowerCase();
    if (round2Eligible) {
      usedRefinedQuery = round1.refinedQuery;
      const round2 = await runSearchRound({
        query: round1.refinedQuery,
        netSuffix: "net2",
        ts,
        slug,
        derivedDir: dirs.derived,
        candidates,
        serpKey: serpKey ?? null,
        serpEnvName: envName,
        maxNetworkFetch,
        maxImageBytes,
        visionKey: visionKey ?? null,
        visionModel,
        visionEnabled: enableVisionFilter,
        // Round 2 doesn't ask for another refinement — hard cap is two rounds.
        askForRefinedQuery: false,
        referenceAbs: refAbs,
        knobs,
      });
      if (round2.attempted) networkFetchAttempted = true;
      // Surface a round-2 failure only if round 1 didn't have its own.
      if (round2.failureReason && !networkFetchFailureReason) {
        networkFetchFailureReason = `round2: ${round2.failureReason}`;
      }
      if (round2.visionApplied) {
        visionFilterApplied = true;
        visionFilterMatches += round2.visionMatches;
        visionFilterRounds = 2;
      }
    }
  }

  if (candidates.length === 0) {
    throw new HandlerError(
      "relic-smart-image-pick: no candidates produced (no user images and network fetch failed)",
      "INVALID_CONFIG",
    );
  }

  // 3. Recommend the highest-scored, non-deleted candidate as primary.
  const sorted = [...candidates]
    .filter((c) => !c.deleted)
    .sort((a, b) => b.score - a.score);
  const recommendedPrimaryPath = (sorted[0] ?? candidates[0]).path;

  return {
    candidates,
    recommendedPrimaryPath,
    visionFilterApplied,
    visionFilterMatches,
    visionFilterRounds,
    networkFetchAttempted,
    ...(networkFetchFailureReason ? { networkFetchFailureReason } : {}),
    ...(usedRefinedQuery ? { refinedQueryUsed: usedRefinedQuery } : {}),
  };
};
