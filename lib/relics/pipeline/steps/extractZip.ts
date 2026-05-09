import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { resolveRelicAsset } from "@/lib/relicStorage";
import type { PipelineContext, StepResult } from "../context";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic"]);
const MAX_IMAGES_TO_PROCESS = 10;

// macOS / Windows sidecar files that show up inside zips and casual file
// dumps. AppleDouble files (`._*`) keep the original extension so they
// sneak past IMAGE_EXTS as bogus 0-byte "images"; __MACOSX is the folder
// macOS adds when zipping; .DS_Store / Thumbs.db are filesystem indices.
function isJunkFile(relPath: string): boolean {
  const base = relPath.split(/[/\\]/).pop() ?? "";
  if (base.startsWith("._")) return true;
  if (base === ".DS_Store" || base === "Thumbs.db") return true;
  if (relPath.startsWith("__MACOSX/") || relPath.includes("/__MACOSX/")) return true;
  return false;
}

export type ExtractZipResult = {
  imagePaths: string[];
  archivedImagePaths: string[];
  otherFiles: string[];
};

export async function stepExtractZip(ctx: PipelineContext): Promise<StepResult<ExtractZipResult>> {
  return extractOrClassify({
    archivePath: ctx.relic.archivePath,
    extractedDir: ctx.dirs.extracted,
  });
}

// Workspace-agnostic extract: used by both stepExtractZip (Relic pipeline)
// and the draft pipeline, which works against _drafts/<draftId>/ directories
// before any Relic row exists.
export async function extractOrClassify(args: {
  archivePath: string | null;
  extractedDir: string;
}): Promise<StepResult<ExtractZipResult>> {
  const { archivePath, extractedDir } = args;

  if (!archivePath) {
    return classifyStaged(extractedDir);
  }
  const archiveAbs = resolveRelicAsset(archivePath);
  if (!archiveAbs) {
    return { ok: false, error: "invalid archive path (path traversal blocked)" };
  }

  await fs.rm(extractedDir, { recursive: true, force: true });
  await fs.mkdir(extractedDir, { recursive: true });

  const buf = await fs.readFile(archiveAbs);
  const zip = await JSZip.loadAsync(buf);

  const allImages: string[] = [];
  const otherFiles: string[] = [];

  const entries = Object.values(zip.files)
    .filter((e) => !e.dir)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const safeName = entry.name.replace(/^[/\\]+/, "");
    if (safeName.includes("..")) continue;
    if (isJunkFile(safeName)) continue;
    const out = path.join(extractedDir, safeName);
    const outDirAbs = path.dirname(out);
    if (!outDirAbs.startsWith(extractedDir)) continue;
    await fs.mkdir(outDirAbs, { recursive: true });
    const data = await entry.async("nodebuffer");
    await fs.writeFile(out, data);

    const ext = path.extname(safeName).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      allImages.push(safeName);
    } else {
      otherFiles.push(safeName);
    }
  }

  const imagePaths = allImages.slice(0, MAX_IMAGES_TO_PROCESS);

  return {
    ok: true,
    data: { imagePaths, archivedImagePaths: allImages, otherFiles },
  };
}

async function classifyStaged(extractedDir: string): Promise<StepResult<ExtractZipResult>> {
  const allImages: string[] = [];
  const otherFiles: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (isJunkFile(rel + "/")) continue;
        await walk(abs, rel);
      } else if (ent.isFile()) {
        if (isJunkFile(rel)) continue;
        const ext = path.extname(ent.name).toLowerCase();
        if (IMAGE_EXTS.has(ext)) allImages.push(rel);
        else otherFiles.push(rel);
      }
    }
  }
  await walk(extractedDir, "");
  const imagePaths = allImages.slice(0, MAX_IMAGES_TO_PROCESS);
  return {
    ok: true,
    data: { imagePaths, archivedImagePaths: allImages, otherFiles },
  };
}
