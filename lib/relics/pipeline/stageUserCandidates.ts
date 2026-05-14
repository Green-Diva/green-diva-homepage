// Pipeline staging — copy raw user images into derived/ as candidate
// rows for the draft pipeline. The largest candidate (by file size) is
// chosen as `primaryImagePath` by the GENERATE_METADATA step.
//
// Boundary follows the same rule as scanWorkspace + readImageAsDataUri:
// IO sits in the pipeline / endpoint layer; the agent DAG only sees
// shaped JSON.
//
// Returns:
//   userCandidates: Array<{ path, source: "user", originalFilename,
//                            width?, height?, score, deleted: false,
//                            absPath }>
//     - `path` is the public-style relative path Relic columns store
//       ("/<slug>/derived/<filename>").
//     - `absPath` is the on-disk absolute path.
//   referenceImageAbs: abs path of the largest user image (highest
//     score), or null when there were no usable images. Currently unused
//     by the draft pipeline; kept for future image-similarity callers.

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pipelineDirsForSlug } from "./context";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif"]);

function isSidecarBasename(p: string): boolean {
  const base = path.basename(p);
  return base.startsWith("._") || base === ".DS_Store" || base === "Thumbs.db";
}

export type StagedCandidate = {
  path: string;
  source: "user";
  originalFilename: string;
  width?: number;
  height?: number;
  score: number;
  deleted: false;
  absPath: string;
};

export type StageResult = {
  userCandidates: StagedCandidate[];
  referenceImageAbs: string | null;
};

// PNG-only header probe — cheap, monotonic. JPEG/WEBP fall through to
// undefined; downstream score still ranks by file size, which is enough
// for "biggest user image is recommended primary" semantics.
async function probePngDimensions(
  abs: string,
): Promise<{ width: number; height: number } | undefined> {
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(abs, "r");
    const buf = Buffer.alloc(24);
    await fh.read(buf, 0, 24, 0);
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    if (fh) await fh.close();
  }
}

export async function stageUserCandidates(
  workspaceSlug: string,
  imageAbsPaths: string[],
): Promise<StageResult> {
  const dirs = pipelineDirsForSlug(workspaceSlug);
  await fs.mkdir(dirs.derived, { recursive: true });
  const ts = Date.now();
  const out: StagedCandidate[] = [];
  let bestAbs: string | null = null;
  let bestSize = 0;

  for (let i = 0; i < imageAbsPaths.length; i++) {
    const src = imageAbsPaths[i];
    if (typeof src !== "string") continue;
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
    let size = 0;
    try {
      size = (await fs.stat(dstAbs)).size;
    } catch {
      // keep size=0 — score still wins over no entry
    }
    const dims = await probePngDimensions(dstAbs);
    out.push({
      path: `/${workspaceSlug}/derived/${dstName}`,
      source: "user",
      originalFilename: path.basename(src),
      width: dims?.width,
      height: dims?.height,
      score: 50 + Math.round(size / 1024 / 1024),
      deleted: false,
      absPath: dstAbs,
    });
    if (size > bestSize) {
      bestSize = size;
      bestAbs = dstAbs;
    }
  }

  return { userCandidates: out, referenceImageAbs: bestAbs };
}
