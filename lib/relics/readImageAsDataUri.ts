// Pipeline-layer helper: read a relic-relative image path from
// RELIC_STORAGE_ROOT and base64-encode it as a data URI suitable for
// inlining in the agent.input passed to dispatchScene.
//
// Why this is here, not as an INTERNAL skill:
//   image-to-data-uri was originally an INTERNAL handler living inside
//   the agent DAG (slot 0 of CUTOUT-FORGE / MESHY-FORGE). That put a
//   pure FS-read protocol-adapter step in the same layer as AI
//   inference. Following the same boundary as scanWorkspace + lore-forge
//   v2: the trigger endpoint has the path, owns the read, and hands the
//   bytes (already encoded) to the agent. The forge DAG only does the
//   external API call + writeback.
//
// Path-traversal defended via resolveRelicAsset. Throws on missing /
// oversized files; caller decides whether to surface as 4xx/5xx.

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveRelicAsset, inferContentType } from "@/lib/relicStorage";

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export class ReadImageError extends Error {
  constructor(
    message: string,
    public code: "BAD_PATH" | "NOT_FOUND" | "TOO_LARGE" | "READ_FAILED",
  ) {
    super(message);
    this.name = "ReadImageError";
  }
}

export type ImageDataUri = {
  dataUri: string;
  contentType: string;
  bytes: number;
};

export async function readRelicImageAsDataUri(
  relativePath: string,
  opts: { maxBytes?: number } = {},
): Promise<ImageDataUri> {
  const abs = resolveRelicAsset(relativePath);
  if (!abs) {
    throw new ReadImageError(
      `path "${relativePath}" failed path-traversal check`,
      "BAD_PATH",
    );
  }

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    throw new ReadImageError(`image not found at "${relativePath}"`, "NOT_FOUND");
  }
  if (stat.size > maxBytes) {
    throw new ReadImageError(
      `image ${stat.size} bytes exceeds max ${maxBytes}`,
      "TOO_LARGE",
    );
  }

  let buf;
  try {
    buf = await fs.readFile(abs);
  } catch (e) {
    throw new ReadImageError(
      `read failed: ${e instanceof Error ? e.message : String(e)}`,
      "READ_FAILED",
    );
  }

  const contentType = inferContentType(path.basename(abs));
  return {
    dataUri: `data:${contentType};base64,${buf.toString("base64")}`,
    contentType,
    bytes: buf.byteLength,
  };
}
