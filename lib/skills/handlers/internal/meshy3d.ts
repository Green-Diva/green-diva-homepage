// INTERNAL handler: meshy-3d
//
// Drives Meshy's image-to-3D endpoint end to end:
//   1. Uploads the chosen image (via base64 data URI in the JSON request body
//      — Meshy supports both URL and base64 image inputs).
//   2. POST  /openapi/v1/image-to-3d           → returns { result: <taskId> }
//   3. Poll  /openapi/v1/image-to-3d/<taskId>  every POLL_MS until status
//      is SUCCEEDED / FAILED / EXPIRED, or until POLL_TIMEOUT_MS elapses.
//   4. Download the GLB at task.model_urls.glb to private/relics/<slug>/derived/
//      and return its relative path.
//
// We intentionally swallow the async-vs-sync impedance here (busy-wait inside
// a single skill handler) per CLAUDE.md "Skill Handler 与运行时" — for v1 the
// Backbone worker just stays parked for up to ~5 minutes. Production-grade
// pattern (split into "submit" + "wait" steps with an external WAIT job
// status) is on the Phase 6 roadmap.
//
// handlerConfig:
//   {
//     authEnv?: string,        // default "MESHY_API_KEY"
//     mode?: "preview"|"refine", // default "preview" — preview is faster + cheaper
//     pollIntervalMs?: number, // default 10_000
//     pollTimeoutMs?: number,  // default 5 * 60_000
//     baseUrl?: string,        // default "https://api.meshy.ai"
//   }
//
// Input:
//   { relicSlug: string, primaryImagePath: string } | { _dryRun: true }
//
// Output:
//   { modelPath: string, taskId: string, previewImageUrl?: string,
//     elapsedMs: number }

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { HandlerError, type SkillHandler } from "../../types";

const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_BASE_URL = "https://api.meshy.ai";
const DEFAULT_AUTH_ENV = "MESHY_API_KEY";
const DEFAULT_POLL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type MeshyTask = {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELED";
  model_urls?: { glb?: string; fbx?: string; obj?: string };
  thumbnail_url?: string;
  task_error?: { message?: string };
  progress?: number;
};

async function meshyPost(opts: {
  baseUrl: string;
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl}/openapi/v1/image-to-3d`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(opts.body),
    });
  } catch (e) {
    throw new HandlerError(
      `meshy-3d: submit failed: ${e instanceof Error ? e.message : String(e)}`,
      "PROVIDER_ERROR",
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HandlerError(
      `meshy-3d: submit returned HTTP ${res.status}: ${text.slice(0, 300)}`,
      "PROVIDER_ERROR",
    );
  }
  const data = (await res.json().catch(() => ({}))) as { result?: string };
  if (!data.result) {
    throw new HandlerError("meshy-3d: submit response missing result (taskId)", "PROVIDER_ERROR");
  }
  return data.result;
}

async function meshyPoll(opts: {
  baseUrl: string;
  apiKey: string;
  taskId: string;
}): Promise<MeshyTask> {
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl}/openapi/v1/image-to-3d/${opts.taskId}`, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });
  } catch (e) {
    throw new HandlerError(
      `meshy-3d: poll failed: ${e instanceof Error ? e.message : String(e)}`,
      "PROVIDER_ERROR",
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HandlerError(
      `meshy-3d: poll HTTP ${res.status}: ${text.slice(0, 300)}`,
      "PROVIDER_ERROR",
    );
  }
  return (await res.json()) as MeshyTask;
}

async function downloadGlb(url: string, dstAbs: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new HandlerError(`meshy-3d: GLB download HTTP ${res.status}`, "PROVIDER_ERROR");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dstAbs, buf);
}

export const meshy3d: SkillHandler = async (input, config) => {
  const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl : DEFAULT_BASE_URL;
  const envName = typeof config.authEnv === "string" && config.authEnv ? config.authEnv : DEFAULT_AUTH_ENV;
  const apiKey = process.env[envName];
  const mode = config.mode === "refine" ? "refine" : "preview";
  const pollIntervalMs =
    typeof config.pollIntervalMs === "number" ? config.pollIntervalMs : DEFAULT_POLL_MS;
  const pollTimeoutMs =
    typeof config.pollTimeoutMs === "number" ? config.pollTimeoutMs : DEFAULT_TIMEOUT_MS;

  if (!isObject(input)) {
    throw new HandlerError("meshy-3d: input must be an object", "INVALID_CONFIG");
  }
  if (input._dryRun === true) {
    return {
      modelPath: "/_dryrun/derived/model-fake.glb",
      taskId: "dry-run-fake-task",
      previewImageUrl: undefined,
      elapsedMs: 0,
    };
  }

  if (!apiKey) {
    throw new HandlerError(`meshy-3d: env "${envName}" not set`, "MISSING_ENV");
  }

  const slug = typeof input.relicSlug === "string" ? input.relicSlug : null;
  if (!slug || !SAFE_SLUG_RE.test(slug)) {
    throw new HandlerError("meshy-3d: invalid relicSlug", "INVALID_CONFIG");
  }
  const primaryImagePath =
    typeof input.primaryImagePath === "string" ? input.primaryImagePath : null;
  if (!primaryImagePath) {
    throw new HandlerError("meshy-3d: input.primaryImagePath required", "INVALID_CONFIG");
  }

  // Resolve image to absolute path + base64 data URI for the API.
  const imageAbs = resolveRelicAsset(primaryImagePath);
  if (!imageAbs) {
    throw new HandlerError("meshy-3d: primaryImagePath did not resolve safely", "INVALID_CONFIG");
  }
  const ext = path.extname(imageAbs).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) {
    throw new HandlerError(`meshy-3d: unsupported image extension "${ext}"`, "INVALID_CONFIG");
  }
  let imageBuf: Buffer;
  try {
    imageBuf = await fs.readFile(imageAbs);
  } catch (e) {
    throw new HandlerError(
      `meshy-3d: could not read primary image: ${e instanceof Error ? e.message : String(e)}`,
      "INVALID_CONFIG",
    );
  }
  const dataUri = `data:${mime};base64,${imageBuf.toString("base64")}`;

  const startedAt = Date.now();
  const taskId = await meshyPost({
    baseUrl,
    apiKey,
    body: { image_url: dataUri, ai_model: "meshy-6", topology: "triangle", mode },
  });

  // Poll until terminal state. Always sleep between polls to avoid hammering.
  let task: MeshyTask | null = null;
  const deadline = startedAt + pollTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    task = await meshyPoll({ baseUrl, apiKey, taskId });
    if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "EXPIRED" || task.status === "CANCELED") {
      break;
    }
  }
  if (!task) {
    throw new HandlerError("meshy-3d: poll loop exited without a task snapshot", "PROVIDER_ERROR");
  }
  if (task.status !== "SUCCEEDED") {
    if (Date.now() >= deadline) {
      throw new HandlerError(
        `meshy-3d: timeout after ${pollTimeoutMs}ms (last status: ${task.status})`,
        "TIMEOUT",
      );
    }
    throw new HandlerError(
      `meshy-3d: task ${task.status}: ${task.task_error?.message ?? "unknown"}`,
      "PROVIDER_ERROR",
    );
  }
  const glbUrl = task.model_urls?.glb;
  if (!glbUrl) {
    throw new HandlerError("meshy-3d: SUCCEEDED but no GLB URL", "PROVIDER_ERROR");
  }

  // Download GLB into the relic's derived/.
  const dirs = pipelineDirsForSlug(slug);
  await fs.mkdir(dirs.derived, { recursive: true });
  const dstName = `model-${Date.now()}.glb`;
  const dstAbs = path.join(dirs.derived, dstName);
  await downloadGlb(glbUrl, dstAbs);
  const modelPath = `/${slug}/derived/${dstName}`;

  return {
    modelPath,
    taskId,
    previewImageUrl: task.thumbnail_url,
    elapsedMs: Date.now() - startedAt,
  };
};
