// INTERNAL handler: relic-smart-image-pick
//
// Replaces the v1 relicImagePick (which just picked the largest user image).
// Now produces a CANDIDATE SET — every user image is registered, plus optional
// network images fetched via SerpAPI when Gemini Researcher decided the relic
// is a mass-produced item with cleaner stock photography available.
//
// The candidate set is what admin sees in the review UI (RelicForm
// CandidateImageGallery). They can toggle delete + change which one is the
// primary. Recommended primary on output is just AI's first guess.
//
// handlerConfig:
//   {
//     searchAuthEnv?: string,         // default "SERPAPI_KEY"
//     maxNetworkFetch?: number,       // default 3
//     maxImageBytes?: number,         // per-image cap, default 10MB
//   }
//
// Input:
//   { relicSlug, imageAbsPaths: string[], useUserImage: boolean,
//     networkImageQuery?: string } | { _dryRun: true }
//
// Output:
//   { candidates: CandidateImage[], recommendedPrimaryPath: string,
//     networkFetchAttempted: boolean, networkFetchFailureReason?: string }

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { HandlerError, type SkillHandler } from "../../types";

const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif"]);
const WATERMARK_HINTS = /watermark|preview|sample|stocksy|gettyimages/i;
const DEFAULT_MAX_NET = 3;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

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

  // 2. Fetch network images if AI requested.
  let networkFetchAttempted = false;
  let networkFetchFailureReason: string | undefined;
  if (!useUserImage && networkImageQuery) {
    const apiKey = process.env[envName];
    if (!apiKey) {
      networkFetchFailureReason = `env "${envName}" not set`;
    } else {
      networkFetchAttempted = true;
      try {
        const url = new URL("https://serpapi.com/search.json");
        url.searchParams.set("engine", "google_images");
        url.searchParams.set("q", networkImageQuery);
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("ijn", "0");
        const sres = await fetch(url.toString());
        if (!sres.ok) {
          networkFetchFailureReason = `SerpAPI HTTP ${sres.status}`;
        } else {
          const sjson = (await sres.json()) as SerpResponse;
          if (sjson.error) {
            networkFetchFailureReason = `SerpAPI: ${sjson.error}`;
          } else {
            const results = (sjson.images_results ?? [])
              .filter((r) => typeof r.original === "string" && !WATERMARK_HINTS.test(r.original ?? ""))
              .filter((r) => typeof r.original_width === "number" && (r.original_width ?? 0) >= 600)
              .sort((a, b) => (b.original_width ?? 0) * (b.original_height ?? 0) -
                              (a.original_width ?? 0) * (a.original_height ?? 0))
              .slice(0, maxNetworkFetch);
            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              const origUrl = r.original!;
              try {
                const dlRes = await fetch(origUrl, {
                  headers: { "User-Agent": "Mozilla/5.0 (compatible; GreenDiva/1.0)" },
                });
                if (!dlRes.ok) continue;
                const cl = Number(dlRes.headers.get("content-length") ?? 0);
                if (cl > maxImageBytes) continue;
                const buf = Buffer.from(await dlRes.arrayBuffer());
                if (buf.length > maxImageBytes) continue;
                const ct = dlRes.headers.get("content-type") ?? "";
                let ext = ".jpg";
                if (ct.includes("png")) ext = ".png";
                else if (ct.includes("webp")) ext = ".webp";
                else if (ct.includes("gif")) ext = ".gif";
                const dstName = `cand-${ts}-net-${i}${ext}`;
                const dstAbs = path.join(dirs.derived, dstName);
                await fs.writeFile(dstAbs, buf);
                candidates.push({
                  path: `/${slug}/derived/${dstName}`,
                  source: "network",
                  originalFilename: new URL(origUrl).hostname,
                  sourceUrl: origUrl,
                  width: r.original_width,
                  height: r.original_height,
                  // Network bonus: prefer over user (mass-produced items have
                  // cleaner stock photography than handheld snaps), capped at +30.
                  score: 80 + Math.min(20, Math.round(((r.original_width ?? 0) * (r.original_height ?? 0)) / 1_000_000)),
                  deleted: false,
                });
              } catch (e) {
                networkFetchFailureReason ??= `download failed: ${e instanceof Error ? e.message : String(e)}`;
              }
            }
          }
        }
      } catch (e) {
        networkFetchFailureReason = `SerpAPI fetch threw: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  if (candidates.length === 0) {
    throw new HandlerError(
      "relic-smart-image-pick: no candidates produced (no user images and network fetch failed)",
      "INVALID_CONFIG",
    );
  }

  // 3. Recommend the highest-scored as primary.
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const recommendedPrimaryPath = sorted[0].path;

  return {
    candidates,
    recommendedPrimaryPath,
    networkFetchAttempted,
    ...(networkFetchFailureReason ? { networkFetchFailureReason } : {}),
  };
};
