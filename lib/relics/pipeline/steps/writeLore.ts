import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import {
  writeLoreCapability,
} from "@/lib/clerics/diva-001/write-lore";
import type {
  StructuredNamingImage,
  StructuredNamingMediaType,
} from "@/lib/clerics/diva-001/structured-naming";
import { getSecretOrEnv } from "@/lib/clericSecrets";
import type { PipelineContext, StepResult } from "../context";
import type { RemoveBgResult } from "./removeBg";
import type { StructuredFieldsResult } from "./structuredFields";
import type { WebResearchResult } from "./webResearch";

export type WriteLoreResult = {
  loreEn: string;
  loreZh: string;
  status: "succeeded" | "skipped";
  reason?: string;
};

const PLACEHOLDER_EN = "(Awaiting cleric composition.)";
const PLACEHOLDER_ZH = "（等候代理撰写。）";

export async function stepWriteLore(
  ctx: PipelineContext,
): Promise<StepResult<WriteLoreResult>> {
  if (!(await getSecretOrEnv("ANTHROPIC_API_KEY"))) {
    return await persistLore(ctx, {
      loreEn: PLACEHOLDER_EN,
      loreZh: PLACEHOLDER_ZH,
      status: "skipped",
      reason: "ANTHROPIC_API_KEY not configured",
    });
  }

  const removeBg = ctx.results.get("REMOVE_BG") as RemoveBgResult | undefined;
  const fields = ctx.results.get("STRUCTURED_FIELDS") as StructuredFieldsResult | undefined;
  const research = ctx.results.get("WEB_RESEARCH") as WebResearchResult | undefined;
  if (!removeBg || !fields) {
    return { ok: false, error: "missing upstream step results (removeBg / structuredFields)" };
  }

  const images: StructuredNamingImage[] = [];
  for (const fileName of removeBg.cleanFileNames) {
    const ext = path.extname(fileName).toLowerCase();
    const mediaType = mediaTypeFromExt(ext);
    if (!mediaType) continue;
    try {
      const buf = await fs.readFile(path.join(ctx.dirs.derived, fileName));
      images.push({ mediaType, base64: buf.toString("base64") });
    } catch (e) {
      console.warn(`[pipeline/writeLore] could not read ${fileName}`, e);
    }
  }

  try {
    const out = await writeLoreCapability.run(ctx.cleric, {
      nameEn: fields.nameEn,
      nameZh: fields.nameZh,
      classifEn: fields.classifEn,
      classifZh: fields.classifZh,
      description: ctx.relic.draftNote ?? "",
      snippets: research?.snippets ?? [],
      images,
    });
    return await persistLore(ctx, {
      loreEn: out.loreEn,
      loreZh: out.loreZh,
      status: "succeeded",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[pipeline/writeLore] capability failed", msg);
    return await persistLore(ctx, {
      loreEn: PLACEHOLDER_EN,
      loreZh: PLACEHOLDER_ZH,
      status: "skipped",
      reason: `capability failed: ${msg.slice(0, 200)}`,
    });
  }
}

async function persistLore(
  ctx: PipelineContext,
  result: WriteLoreResult,
): Promise<StepResult<WriteLoreResult>> {
  await prisma.relic.update({
    where: { id: ctx.relic.id },
    data: { loreEn: result.loreEn, loreZh: result.loreZh },
  });
  return { ok: true, data: result };
}

function mediaTypeFromExt(ext: string): StructuredNamingMediaType | null {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}
