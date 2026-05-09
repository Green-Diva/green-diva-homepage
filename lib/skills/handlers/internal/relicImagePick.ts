// INTERNAL handler: relic-image-pick
//
// 2D path's v1 implementation: pick the largest image by file size from the
// relic's source/extracted/, copy it to derived/primary-{ts}.{ext}, and
// return a relative URL the frontend can render via /api/relics/{slug}/asset.
//
// This is intentionally dumb. The user agreed v1 skips background removal
// and multi-image composition; those will arrive in a follow-up iteration
// using @imgly/background-removal-node.
//
// handlerConfig: (none required)
//
// Input:
//   { relicSlug: string, imageAbsPaths?: string[] } | { _dryRun: true }
//   - relicSlug is required (used to write into the relic's derived/ dir)
//   - imageAbsPaths optional: if absent, scans extracted/ on disk
//
// Output:
//   { primaryImageUrl: string, primaryImagePath: string, sourcePath: string,
//     pickedFromCount: number }

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { HandlerError, type SkillHandler } from "../../types";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif"]);
const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function listImages(extractedDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(abs);
      else if (ent.isFile() && IMAGE_EXTS.has(path.extname(ent.name).toLowerCase())) {
        out.push(abs);
      }
    }
  }
  await walk(extractedDir);
  return out;
}

export const relicImagePick: SkillHandler = async (input) => {
  if (!isObject(input)) {
    throw new HandlerError(
      "relic-image-pick: input must be an object",
      "INVALID_CONFIG",
    );
  }

  if (input._dryRun === true) {
    return {
      primaryImagePath: "/_dryrun/derived/primary-fake.jpg",
      sourcePath: "letter-page-1.jpg",
      pickedFromCount: 0,
    };
  }

  const slug = typeof input.relicSlug === "string" ? input.relicSlug : null;
  if (!slug || !SAFE_SLUG_RE.test(slug)) {
    throw new HandlerError("relic-image-pick: invalid relicSlug", "INVALID_CONFIG");
  }

  const dirs = pipelineDirsForSlug(slug);
  let candidates: string[];
  if (Array.isArray(input.imageAbsPaths)) {
    candidates = (input.imageAbsPaths as unknown[]).filter(
      (p): p is string => typeof p === "string",
    );
  } else {
    candidates = await listImages(dirs.extracted);
  }

  if (candidates.length === 0) {
    throw new HandlerError("relic-image-pick: no images found", "INVALID_CONFIG");
  }

  // Pick the largest by file size (proxy for "best resolution"). v2 will
  // replace this with image-quality scoring + dedup.
  let best: { abs: string; size: number } | null = null;
  for (const abs of candidates) {
    try {
      const stat = await fs.stat(abs);
      if (!best || stat.size > best.size) best = { abs, size: stat.size };
    } catch {
      continue;
    }
  }
  if (!best) {
    throw new HandlerError("relic-image-pick: all candidates unreadable", "INVALID_CONFIG");
  }

  const ext = path.extname(best.abs).toLowerCase();
  const dstName = `primary-${Date.now()}${ext}`;
  await fs.mkdir(dirs.derived, { recursive: true });
  const dstAbs = path.join(dirs.derived, dstName);
  await fs.copyFile(best.abs, dstAbs);

  // Relative path stored in Relic.primaryImagePath. Resolved by
  // /api/relics/[id]/primary at request time (Phase 5 endpoint).
  const primaryImagePath = `/${slug}/derived/${dstName}`;
  const sourcePath = path.relative(dirs.extracted, best.abs).split(path.sep).join("/");

  return {
    primaryImagePath,
    sourcePath,
    pickedFromCount: candidates.length,
  };
};
