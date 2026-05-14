// POST /api/relics/[id]/lens-search — admin-only, sync.
//
// Reverse-image-search the relic's primary image via Google Cloud Vision
// API (WEB_DETECTION) + Gemini visual-similarity scoring. Returns a list
// of `{ imageUrl, sourceUrl, thumbnailUrl, title, score }` matches sorted
// by score descending.
//
// Endpoint is a thin wire-up shell (~80 lines): admin auth + per-relic
// rate limit + read primary image (twice: as base64 for Vision API, as
// abs path copy for Gemini scoring) + callScene. The agent
// (LENS-FORGE-001) does the actual Vision API call, candidate downloads,
// vision scoring, and shaping — admin can swap implementations via
// SceneBinding without touching this file.
//
// Why sync (callScene) not async (dispatchScene): one Vision API call
// (~3 s) + 15 forEach iterations of Gemini scoring (~30 s) → ~35 s typical.
// AgentJob persistence isn't needed; admin waits in the modal.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { callScene, SceneError } from "@/lib/agent-service";
import { respondError, respondAuthError } from "@/lib/api-error";
import { AgentErrorCode } from "@/lib/agent-errors";

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024; // Vision API soft cap ≈ 20MB; we use 10MB.
// Match scene.slaMs (120 s). Vision + 8×Gemini sequential scoring lands
// 50-90 s typical; 60 s was too tight in practice.
const SCENE_TIMEOUT_MS = 120_000;

// Per-relic rate limit. Vision API + 15 Gemini calls is real money per
// click; cap to one search per minute per relic. Pattern mirrors
// app/api/vault/unseal/route.ts (in-memory, single-process, fine for now).
const RATE_WINDOW_MS = 60_000;
const lastSearchAt = new Map<string, number>();

function rateLimited(relicId: string): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const prev = lastSearchAt.get(relicId);
  if (prev && now - prev < RATE_WINDOW_MS) {
    return { limited: true, retryAfterSec: Math.ceil((RATE_WINDOW_MS - (now - prev)) / 1000) };
  }
  lastSearchAt.set(relicId, now);
  return { limited: false, retryAfterSec: 0 };
}

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }

  const { id } = await ctx.params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, primaryImagePath: true },
  });
  if (!relic) return respondError(AgentErrorCode.NOT_FOUND, "relic not found", 404);
  if (!relic.primaryImagePath) {
    return respondError(
      AgentErrorCode.VALIDATION_FAILED,
      "relic has no primaryImagePath — pick a primary image first",
      400,
    );
  }

  const rate = rateLimited(relic.id);
  if (rate.limited) {
    const res = respondError(
      AgentErrorCode.CONFLICT,
      `lens-search rate-limited (1/min/relic). Retry in ${rate.retryAfterSec}s.`,
      429,
    );
    res.headers.set("Retry-After", String(rate.retryAfterSec));
    return res;
  }

  const abs = resolveRelicAsset(relic.primaryImagePath);
  if (!abs) {
    return respondError(
      AgentErrorCode.PATH_TRAVERSAL_BLOCKED,
      "primaryImagePath failed path-traversal check",
      400,
    );
  }

  let primaryBuf: Buffer;
  try {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_REFERENCE_BYTES) {
      return respondError(
        AgentErrorCode.VALIDATION_FAILED,
        `primary image ${stat.size}B exceeds Vision API budget ${MAX_REFERENCE_BYTES}B`,
        413,
      );
    }
    primaryBuf = await fs.readFile(abs);
  } catch (e) {
    return respondError(
      AgentErrorCode.NOT_FOUND,
      `primary image read failed: ${e instanceof Error ? e.message : "unknown"}`,
      404,
    );
  }
  const referenceImageBase64 = primaryBuf.toString("base64");

  // Stage a temp copy in derived/ so the agent's Gemini scoring step can
  // read by abs path. Same workspace pattern as the lens-tmp-* candidate
  // files written by the persist primitive inside the agent's forEach.
  const dirs = pipelineDirsForSlug(relic.slug);
  await fs.mkdir(dirs.derived, { recursive: true });
  const refExt = path.extname(abs).toLowerCase() || ".jpg";
  const refFilename = `lens-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${refExt}`;
  const referenceImageAbs = path.join(dirs.derived, refFilename);
  await fs.writeFile(referenceImageAbs, primaryBuf);

  let result;
  try {
    result = await callScene<{
      matches: Array<{
        imageUrl: string;
        sourceUrl: string;
        thumbnailUrl?: string;
        title?: string;
        score: number;
      }>;
    }>(
      "relic.network-image-search",
      {
        relicId: relic.id,
        relicSlug: relic.slug,
        referenceImageBase64,
        referenceImageAbs,
      },
      {
        actor: { userId: me.id, level: me.level, name: me.name },
        timeoutMs: SCENE_TIMEOUT_MS,
      },
    );
  } catch (e) {
    if (e instanceof SceneError) {
      return respondError(
        AgentErrorCode.DISPATCH_FAILED,
        `lens-search dispatch failed: ${e.message}`,
        e.httpStatus,
      );
    }
    console.error("[api/relics/lens-search] callScene threw", e);
    return respondError(
      AgentErrorCode.HANDLER_ERROR,
      "lens-search internal error",
      500,
    );
  }

  if (!result.ok) {
    return respondError(
      result.errorCode as AgentErrorCode,
      result.errorMessage,
      result.errorCode === "TIMEOUT" ? 504 : 502,
    );
  }

  return NextResponse.json({
    jobId: result.jobId,
    matches: result.output.matches,
  });
}
