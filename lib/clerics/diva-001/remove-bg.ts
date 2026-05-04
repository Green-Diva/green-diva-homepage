import "server-only";
import type { AgentCapability } from "../types";
import { withInvocationLogging } from "../types";
import { getSecretOrEnv } from "@/lib/agentSecrets";

const ENDPOINT = "https://api.remove.bg/v1.0/removebg";

export type RemoveBgInput = {
  image: { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };
};

export type RemoveBgOutput = {
  cleanImage: { mediaType: "image/png"; base64: string };
};

const baseCapability: AgentCapability<RemoveBgInput, RemoveBgOutput> = {
  id: "remove-bg",
  agentCodename: "DIVA-001",
  metadata: {
    iconKey: "background_replace",
    nameEn: "Silhouette Lift",
    nameZh: "轮廓析出",
    descriptionEn: "Strips backgrounds from a single photo, returning a transparent PNG.",
    descriptionZh: "去除单张照片背景，返回透明底 PNG。",
    provider: "remove.bg",
    requiredEnvVars: ["REMOVE_BG_API_KEY"],
  },
  serializeInput(input) {
    return {
      mediaType: input.image.mediaType,
      sizeBytes: Math.ceil((input.image.base64.length * 3) / 4),
    };
  },
  serializeOutput(output) {
    return {
      mediaType: output.cleanImage.mediaType,
      sizeBytes: Math.ceil((output.cleanImage.base64.length * 3) / 4),
    };
  },
  async run(_agent, input) {
    const key = await getSecretOrEnv("REMOVE_BG_API_KEY");
    if (!key) throw new Error("REMOVE_BG_API_KEY not configured");

    const fd = new FormData();
    fd.append("image_file_b64", input.image.base64);
    fd.append("size", "auto");
    fd.append("format", "png");

    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "X-Api-Key": key },
      body: fd,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`remove.bg ${r.status}: ${txt.slice(0, 200)}`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return { cleanImage: { mediaType: "image/png", base64: buf.toString("base64") } };
  },
};

export const removeBgCapability = withInvocationLogging(baseCapability);
