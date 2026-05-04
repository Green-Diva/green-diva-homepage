import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { removeBgCapability } from "@/lib/clerics/diva-001/remove-bg";
import { getSecretOrEnv } from "@/lib/clericSecrets";
import type { PipelineContext, StepResult } from "../context";
import type { ExtractZipResult } from "./extractZip";

export type RemoveBgResult = {
  cleanRelativePaths: string[];
  cleanFileNames: string[];
  status: "succeeded" | "skipped";
  reason?: string;
  failures?: { source: string; error: string }[];
};

const SUPPORTED_INPUT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export async function stepRemoveBg(ctx: PipelineContext): Promise<StepResult<RemoveBgResult>> {
  const extract = ctx.results.get("EXTRACT_ZIP") as ExtractZipResult | undefined;
  if (!extract) return { ok: false, error: "no extract result available" };

  const skipped = !(await getSecretOrEnv("REMOVE_BG_API_KEY"));
  const failures: { source: string; error: string }[] = [];
  const cleanFileNames: string[] = [];
  const cleanRelativePaths: string[] = [];

  for (let i = 0; i < extract.imagePaths.length; i++) {
    const sourceName = extract.imagePaths[i];
    const srcAbs = path.join(ctx.dirs.extracted, sourceName);
    const ext = path.extname(sourceName).toLowerCase();

    // Always end up with SOMETHING in derived/ so downstream steps can run.
    const fallbackName = `clean-${i + 1}${ext}`;
    const fallbackAbs = path.join(ctx.dirs.derived, fallbackName);

    if (skipped || !SUPPORTED_INPUT.has(ext)) {
      await fs.copyFile(srcAbs, fallbackAbs);
      cleanFileNames.push(fallbackName);
      cleanRelativePaths.push(`/${ctx.relic.slug}/derived/${fallbackName}`);
      if (!skipped) {
        failures.push({ source: sourceName, error: `unsupported ext '${ext}' for remove.bg` });
      }
      continue;
    }

    try {
      const buf = await fs.readFile(srcAbs);
      const mediaType = mediaTypeFromExt(ext);
      const out = await removeBgCapability.run(ctx.cleric, {
        image: { mediaType, base64: buf.toString("base64") },
      });
      const cleanName = `clean-${i + 1}.png`;
      const cleanAbs = path.join(ctx.dirs.derived, cleanName);
      await fs.writeFile(cleanAbs, Buffer.from(out.cleanImage.base64, "base64"));
      cleanFileNames.push(cleanName);
      cleanRelativePaths.push(`/${ctx.relic.slug}/derived/${cleanName}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[pipeline/removeBg] ${sourceName} failed; falling back to original`, msg);
      failures.push({ source: sourceName, error: msg });
      try {
        await fs.copyFile(srcAbs, fallbackAbs);
        cleanFileNames.push(fallbackName);
        cleanRelativePaths.push(`/${ctx.relic.slug}/derived/${fallbackName}`);
      } catch (copyErr) {
        console.error(`[pipeline/removeBg] fallback copy also failed for ${sourceName}`, copyErr);
      }
    }
  }

  await prisma.relic.update({
    where: { id: ctx.relic.id },
    data: { photoPaths: cleanRelativePaths },
  });

  return {
    ok: true,
    data: {
      cleanRelativePaths,
      cleanFileNames,
      status: skipped ? "skipped" : "succeeded",
      ...(skipped ? { reason: "REMOVE_BG_API_KEY not configured" } : {}),
      ...(failures.length ? { failures } : {}),
    },
  };
}

function mediaTypeFromExt(ext: string): "image/jpeg" | "image/png" | "image/webp" {
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}
