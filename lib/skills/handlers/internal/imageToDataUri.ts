// INTERNAL handler: image-to-data-uri
//
// Reads an image from `private/relics/<slug>/...` and base64-encodes it
// into a data URI suitable for inlining into JSON request bodies (e.g.
// Meshy's image-to-3D `image_url` field accepts data URIs in addition
// to remote URLs).
//
// Why INTERNAL: file system access. Skill handlers run inside the main
// app's Node process and have legitimate read access to private/relics/.
// HTTP_API can't do this (no fs); the dedicated handler is intentionally
// the smallest possible surface — pure path → data URI, no business
// logic.
//
// Input:
//   { imagePath: string }   // relic-relative path, e.g. "/vault-028/derived/cutout-123.png"
//                           //   or absolute path inside RELIC_STORAGE_ROOT
//
// Output:
//   { dataUri: string,        // "data:image/png;base64,...."
//     contentType: string,    // mime type
//     bytes: number }         // decoded byte length (sanity / quota check)
//
// handlerConfig:
//   { maxBytes?: number }     // default 25 MB; reject larger files

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { resolveRelicAsset, inferContentType } from "@/lib/relicStorage";
import { HandlerError, type SkillHandler } from "../../types";

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const imageToDataUri: SkillHandler = async (input, config) => {
  if (!isObject(input)) {
    throw new HandlerError(
      "image-to-data-uri: input must be an object with imagePath",
      "INVALID_CONFIG",
    );
  }
  const imagePath = typeof input.imagePath === "string" ? input.imagePath : null;
  if (!imagePath) {
    throw new HandlerError("image-to-data-uri: input.imagePath required", "INVALID_CONFIG");
  }

  // Dry-run convention used elsewhere in this repo: short-circuit with a
  // sample so editor "Test Run" doesn't actually need a real file on disk.
  if (input._dryRun === true) {
    const sample = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    return {
      dataUri: `data:image/png;base64,${sample}`,
      contentType: "image/png",
      bytes: 70,
    };
  }

  const abs = resolveRelicAsset(imagePath);
  if (!abs) {
    throw new HandlerError(
      `image-to-data-uri: imagePath "${imagePath}" failed path-traversal check`,
      "INVALID_CONFIG",
    );
  }

  const maxBytes =
    typeof config.maxBytes === "number" && config.maxBytes > 0
      ? config.maxBytes
      : DEFAULT_MAX_BYTES;

  let buf: Buffer;
  try {
    const stat = await fs.stat(abs);
    if (stat.size > maxBytes) {
      throw new HandlerError(
        `image-to-data-uri: file ${stat.size} bytes exceeds maxBytes ${maxBytes}`,
        "INVALID_CONFIG",
      );
    }
    buf = await fs.readFile(abs);
  } catch (e) {
    if (e instanceof HandlerError) throw e;
    throw new HandlerError(
      `image-to-data-uri: read failed (${imagePath}): ${e instanceof Error ? e.message : String(e)}`,
      "OUTPUT_PARSE",
    );
  }

  const contentType = inferContentType(path.basename(abs));
  return {
    dataUri: `data:${contentType};base64,${buf.toString("base64")}`,
    contentType,
    bytes: buf.byteLength,
  };
};
