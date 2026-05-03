import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import type { Rarity } from "@prisma/client";
import {
  structuredNamingCapability,
  type StructuredNamingImage,
  type StructuredNamingMediaType,
} from "@/lib/agents/diva-001/structured-naming";
import { getSecretOrEnv } from "@/lib/agentSecrets";
import type { PipelineContext, StepResult } from "../context";
import type { RemoveBgResult } from "./removeBg";

export type StructuredFieldsResult = {
  nameEn: string;
  nameZh: string;
  classifEn: string;
  classifZh: string;
  rarity: Rarity;
  iconKey: string;
  status: "succeeded" | "skipped";
  reason?: string;
};

export async function stepStructuredFields(
  ctx: PipelineContext,
): Promise<StepResult<StructuredFieldsResult>> {
  const skipped = !(await getSecretOrEnv("ANTHROPIC_API_KEY"));
  if (skipped) {
    return { ok: true, data: placeholder(ctx, "ANTHROPIC_API_KEY not configured") };
  }

  const removeBg = ctx.results.get("REMOVE_BG") as RemoveBgResult | undefined;
  if (!removeBg) return { ok: false, error: "no removeBg result available" };

  const images: StructuredNamingImage[] = [];
  for (const fileName of removeBg.cleanFileNames) {
    const abs = path.join(ctx.dirs.derived, fileName);
    const ext = path.extname(fileName).toLowerCase();
    const mediaType = mediaTypeFromExt(ext);
    if (!mediaType) continue;
    try {
      const buf = await fs.readFile(abs);
      images.push({ mediaType, base64: buf.toString("base64") });
    } catch (e) {
      console.warn(`[pipeline/structuredFields] could not read ${fileName}`, e);
    }
  }

  const description = ctx.relic.draftNote ?? "";

  let out;
  try {
    out = await structuredNamingCapability.run(ctx.agent, { description, images });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[pipeline/structuredFields] capability failed; using placeholder", msg);
    return {
      ok: true,
      data: placeholder(ctx, `capability failed: ${msg.slice(0, 200)}`),
    };
  }

  await prisma.relic.update({
    where: { id: ctx.relic.id },
    data: {
      nameEn: out.nameEn,
      nameZh: out.nameZh,
      classifEn: out.classifEn,
      classifZh: out.classifZh,
      rarity: out.rarity,
      iconKey: out.iconKey,
    },
  });

  return {
    ok: true,
    data: {
      nameEn: out.nameEn,
      nameZh: out.nameZh,
      classifEn: out.classifEn,
      classifZh: out.classifZh,
      rarity: out.rarity,
      iconKey: out.iconKey,
      status: "succeeded",
    },
  };
}

function placeholder(ctx: PipelineContext, reason: string): StructuredFieldsResult {
  return {
    nameEn: `Vault Sample ${String(ctx.relic.slot).padStart(3, "0")}`,
    nameZh: `圣物样品 #${String(ctx.relic.slot).padStart(3, "0")}`,
    classifEn: "DRAFT · UNCATALOGUED",
    classifZh: "草稿 · 待编目",
    rarity: "COMMON",
    iconKey: "inventory_2",
    status: "skipped",
    reason,
  };
}

function mediaTypeFromExt(ext: string): StructuredNamingMediaType | null {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}
