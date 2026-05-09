// INTERNAL handler: relic-cutout (fal.ai BiRefNet)
//
// Submits the relic's primary image to fal.ai's BiRefNet endpoint, downloads
// the resulting transparent PNG to derived/, and returns its relative path.
// fal.ai's run endpoint is synchronous (~10s) so no polling — much simpler
// than the Meshy handler, which is the inspiration for the file layout.
//
// handlerConfig:
//   {
//     authEnv?: string,            // default "FAL_API_KEY"
//     model?: string,              // default "fal-ai/birefnet/v2"
//     baseUrl?: string,            // default "https://fal.run"
//     timeoutMs?: number,          // default 60_000
//   }
//
// Input:
//   { relicSlug: string, imagePath: string } | { _dryRun: true }
//   - imagePath is a relative path resolved via resolveRelicAsset (the
//     trigger endpoint passes either primaryImagePath or another candidate)
//
// Output:
//   { enhancedImagePath: string, sourceImagePath: string, elapsedMs: number }

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { HandlerError, type SkillHandler } from "../../types";

const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_BASE_URL = "https://fal.run";
const DEFAULT_AUTH_ENV = "FAL_API_KEY";
const DEFAULT_MODEL = "fal-ai/birefnet/v2";
const DEFAULT_TIMEOUT_MS = 60_000;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type FalResponse = {
  image?: { url?: string; content_type?: string; file_size?: number };
};

export const falCutout: SkillHandler = async (input, config) => {
  const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl : DEFAULT_BASE_URL;
  const envName =
    typeof config.authEnv === "string" && config.authEnv ? config.authEnv : DEFAULT_AUTH_ENV;
  const model = typeof config.model === "string" ? config.model : DEFAULT_MODEL;
  const timeoutMs = typeof config.timeoutMs === "number" ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const apiKey = process.env[envName];

  if (!isObject(input)) {
    throw new HandlerError("relic-cutout: input must be an object", "INVALID_CONFIG");
  }
  if (input._dryRun === true) {
    return {
      enhancedImagePath: "/_dryrun/derived/enhanced-fake.png",
      sourceImagePath: "/_dryrun/derived/primary-fake.jpeg",
      elapsedMs: 0,
    };
  }
  if (!apiKey) {
    throw new HandlerError(`relic-cutout: env "${envName}" not set`, "MISSING_ENV");
  }

  const slug = typeof input.relicSlug === "string" ? input.relicSlug : null;
  if (!slug || !SAFE_SLUG_RE.test(slug)) {
    throw new HandlerError("relic-cutout: invalid relicSlug", "INVALID_CONFIG");
  }
  const imagePath =
    typeof input.imagePath === "string" ? input.imagePath : null;
  if (!imagePath) {
    throw new HandlerError("relic-cutout: input.imagePath required", "INVALID_CONFIG");
  }

  // Resolve image to absolute path + base64 data URI for the API.
  const imageAbs = resolveRelicAsset(imagePath);
  if (!imageAbs) {
    throw new HandlerError("relic-cutout: imagePath did not resolve safely", "INVALID_CONFIG");
  }
  const ext = path.extname(imageAbs).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) {
    throw new HandlerError(`relic-cutout: unsupported image extension "${ext}"`, "INVALID_CONFIG");
  }
  let imageBuf: Buffer;
  try {
    imageBuf = await fs.readFile(imageAbs);
  } catch (e) {
    throw new HandlerError(
      `relic-cutout: could not read image: ${e instanceof Error ? e.message : String(e)}`,
      "INVALID_CONFIG",
    );
  }
  const dataUri = `data:${mime};base64,${imageBuf.toString("base64")}`;

  const startedAt = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/${model}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({ image_url: dataUri }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as { name?: string }).name === "AbortError") {
      throw new HandlerError(`relic-cutout: timeout after ${timeoutMs}ms`, "TIMEOUT");
    }
    throw new HandlerError(
      `relic-cutout: submit failed: ${e instanceof Error ? e.message : String(e)}`,
      "PROVIDER_ERROR",
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HandlerError(
      `relic-cutout: submit returned HTTP ${res.status}: ${text.slice(0, 300)}`,
      "PROVIDER_ERROR",
    );
  }
  const data = (await res.json().catch(() => ({}))) as FalResponse;
  const outUrl = data.image?.url;
  if (!outUrl) {
    throw new HandlerError("relic-cutout: response missing image.url", "PROVIDER_ERROR");
  }

  // Download the transparent PNG.
  let dlRes: Response;
  try {
    dlRes = await fetch(outUrl);
  } catch (e) {
    throw new HandlerError(
      `relic-cutout: download failed: ${e instanceof Error ? e.message : String(e)}`,
      "PROVIDER_ERROR",
    );
  }
  if (!dlRes.ok) {
    throw new HandlerError(`relic-cutout: download HTTP ${dlRes.status}`, "PROVIDER_ERROR");
  }
  const outBuf = Buffer.from(await dlRes.arrayBuffer());

  const dirs = pipelineDirsForSlug(slug);
  await fs.mkdir(dirs.derived, { recursive: true });
  const dstName = `enhanced-${Date.now()}.png`;
  const dstAbs = path.join(dirs.derived, dstName);
  await fs.writeFile(dstAbs, outBuf);

  return {
    enhancedImagePath: `/${slug}/derived/${dstName}`,
    sourceImagePath: imagePath,
    elapsedMs: Date.now() - startedAt,
  };
};
