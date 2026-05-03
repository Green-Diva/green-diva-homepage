import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { resolveRelicAsset } from "@/lib/relicStorage";
import type { PipelineContext, StepResult } from "../context";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic"]);
const MAX_IMAGES_TO_PROCESS = 10;

export type ExtractZipResult = {
  imagePaths: string[];
  archivedImagePaths: string[];
  otherFiles: string[];
};

export async function stepExtractZip(ctx: PipelineContext): Promise<StepResult<ExtractZipResult>> {
  if (!ctx.relic.archivePath) {
    return { ok: false, error: "no archive path on relic" };
  }
  const archiveAbs = resolveRelicAsset(ctx.relic.archivePath);
  if (!archiveAbs) {
    return { ok: false, error: "invalid archive path (path traversal blocked)" };
  }

  await fs.rm(ctx.dirs.extracted, { recursive: true, force: true });
  await fs.mkdir(ctx.dirs.extracted, { recursive: true });

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
    const out = path.join(ctx.dirs.extracted, safeName);
    const outDirAbs = path.dirname(out);
    if (!outDirAbs.startsWith(ctx.dirs.extracted)) continue;
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
