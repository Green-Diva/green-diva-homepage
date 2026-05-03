import "server-only";
import type { AgentCapability } from "../types";
import { withInvocationLogging } from "../types";
import { getSecretOrEnv } from "@/lib/agentSecrets";
import type { StructuredNamingImage } from "./structured-naming";

const MESHY_BASE = "https://api.meshy.ai/openapi";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 10 * 60_000;

export type ImageTo3dInput = {
  images: StructuredNamingImage[];
  /** Optional override; defaults to the v2 image-to-3d defaults (~30k tris). */
  targetPolycount?: number;
};

export type ImageTo3dOutput = {
  taskId: string;
  mode: "single" | "multi";
  glbBytes: number;
  glb: Buffer; // raw GLB bytes (not serialized into AgentInvocation)
};

const baseCapability: AgentCapability<ImageTo3dInput, ImageTo3dOutput> = {
  id: "image-to-3d",
  agentCodename: "DIVA-001",
  metadata: {
    iconKey: "deployed_code",
    nameEn: "Form Forge",
    nameZh: "形态锻造",
    descriptionEn: "Drives Meshy multi-image-to-3D; falls back to single-image when multi-view fails.",
    descriptionZh: "调度 Meshy multi-image-to-3D 端点，多视角失败时自动降级单图。",
    provider: "meshy",
    requiredEnvVars: ["MESHY_API_KEY"],
  },
  serializeInput(input) {
    return { imageCount: input.images.length, targetPolycount: input.targetPolycount ?? null };
  },
  serializeOutput(output) {
    return { taskId: output.taskId, mode: output.mode, glbBytes: output.glbBytes };
  },
  async run(_agent, input) {
    const key = await getSecretOrEnv("MESHY_API_KEY");
    if (!key) throw new Error("MESHY_API_KEY not configured");
    if (input.images.length === 0) throw new Error("no input images");

    const tryMulti = input.images.length >= 2;
    try {
      return await runMode(key, tryMulti ? "multi" : "single", input);
    } catch (e) {
      if (tryMulti) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[image-to-3d] multi mode failed; falling back to single: ${msg}`);
        return await runMode(key, "single", { ...input, images: [input.images[0]] });
      }
      throw e;
    }
  },
};

async function runMode(
  key: string,
  mode: "single" | "multi",
  input: ImageTo3dInput,
): Promise<ImageTo3dOutput> {
  const submit = mode === "multi"
    ? await fetch(`${MESHY_BASE}/v1/multi-image-to-3d`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          image_urls: input.images.map((i) => `data:${i.mediaType};base64,${i.base64}`),
          ai_model: "meshy-4",
          topology: "triangle",
          target_polycount: input.targetPolycount ?? 30_000,
          should_remesh: true,
          should_texture: true,
          enable_pbr: false,
        }),
      })
    : await fetch(`${MESHY_BASE}/v2/image-to-3d`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: `data:${input.images[0].mediaType};base64,${input.images[0].base64}`,
          ai_model: "meshy-4",
          topology: "triangle",
          target_polycount: input.targetPolycount ?? 30_000,
          should_remesh: true,
          should_texture: true,
          enable_pbr: false,
        }),
      });

  if (!submit.ok) {
    const txt = await submit.text().catch(() => "");
    throw new Error(`Meshy ${mode} submit ${submit.status}: ${txt.slice(0, 200)}`);
  }
  const submitJson = (await submit.json()) as { result?: string };
  const taskId = submitJson.result;
  if (!taskId) throw new Error(`Meshy ${mode} submit returned no task id`);

  const pollUrl =
    mode === "multi"
      ? `${MESHY_BASE}/v1/multi-image-to-3d/${taskId}`
      : `${MESHY_BASE}/v2/image-to-3d/${taskId}`;

  const start = Date.now();
  while (Date.now() - start < MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const r = await fetch(pollUrl, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) continue;
    const status = (await r.json()) as {
      status?: string;
      model_urls?: { glb?: string };
      task_error?: { message?: string };
    };
    if (status.status === "SUCCEEDED") {
      const glbUrl = status.model_urls?.glb;
      if (!glbUrl) throw new Error(`Meshy ${mode} returned no glb url`);
      const glbR = await fetch(glbUrl);
      if (!glbR.ok) throw new Error(`Meshy GLB download ${glbR.status}`);
      const buf = Buffer.from(await glbR.arrayBuffer());
      return { taskId, mode, glb: buf, glbBytes: buf.length };
    }
    if (status.status === "FAILED" || status.status === "EXPIRED") {
      const errMsg = status.task_error?.message ?? "unknown";
      throw new Error(`Meshy ${mode} ${status.status}: ${errMsg}`);
    }
  }
  throw new Error(`Meshy ${mode} poll timeout after ${MAX_POLL_MS / 1000}s`);
}

export const imageTo3dCapability = withInvocationLogging(baseCapability);
