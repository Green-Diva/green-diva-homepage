import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { imageTo3dCapability } from "@/lib/agents/diva-001/image-to-3d";
import type {
  StructuredNamingImage,
  StructuredNamingMediaType,
} from "@/lib/agents/diva-001/structured-naming";
import { getSecretOrEnv } from "@/lib/agentSecrets";
import type { PipelineContext, StepResult } from "../context";
import type { RemoveBgResult } from "./removeBg";

export type Generate3dResult = {
  status: "succeeded" | "skipped";
  modelRelativePath: string | null;
  taskId?: string;
  mode?: "single" | "multi";
  reason?: string;
};

const MODEL_FILE_NAME = "model.glb";

export async function stepGenerate3d(
  ctx: PipelineContext,
): Promise<StepResult<Generate3dResult>> {
  if (!(await getSecretOrEnv("MESHY_API_KEY"))) {
    return {
      ok: true,
      data: { status: "skipped", modelRelativePath: null, reason: "MESHY_API_KEY not configured" },
    };
  }

  const removeBg = ctx.results.get("REMOVE_BG") as RemoveBgResult | undefined;
  if (!removeBg || removeBg.cleanFileNames.length === 0) {
    return {
      ok: true,
      data: { status: "skipped", modelRelativePath: null, reason: "no cleaned images available" },
    };
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
      console.warn(`[pipeline/generate3d] could not read ${fileName}`, e);
    }
  }
  if (images.length === 0) {
    return {
      ok: true,
      data: { status: "skipped", modelRelativePath: null, reason: "no readable images" },
    };
  }

  try {
    const out = await imageTo3dCapability.run(ctx.agent, { images });
    const dst = path.join(ctx.dirs.derived, MODEL_FILE_NAME);
    await fs.writeFile(dst, out.glb);
    const modelRelativePath = `/${ctx.relic.slug}/derived/${MODEL_FILE_NAME}`;
    await prisma.relic.update({
      where: { id: ctx.relic.id },
      data: { modelPath: modelRelativePath },
    });
    return {
      ok: true,
      data: {
        status: "succeeded",
        modelRelativePath,
        taskId: out.taskId,
        mode: out.mode,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[pipeline/generate3d] capability failed", msg);
    return {
      ok: true,
      data: {
        status: "skipped",
        modelRelativePath: null,
        reason: msg.slice(0, 200),
      },
    };
  }
}

function mediaTypeFromExt(ext: string): StructuredNamingMediaType | null {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}
