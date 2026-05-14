// GET /api/relics/[id]/candidate?path=<slug-scoped-path> — streams a single
// candidate image referenced from Relic.candidateImages. Used by the
// CandidateImageGallery component in RelicForm to render thumbnails.
//
// Defense: ?path must (a) start with /<this-relic-slug>/ (b) appear in the
// stored candidateImages array. Both checks before resolveRelicAsset's
// path-traversal guard, so guessing arbitrary paths is rejected.

import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthError, getCurrentUser, requireAdmin } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { serveImageFile } from "@/lib/relics/serveImage";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { respondError, respondAuthError } from "@/lib/api-error";
import { AgentErrorCode } from "@/lib/agent-errors";
import {
  fetchExternalImage,
  FetchExternalImageError,
} from "@/lib/relics/fetchExternalImage";

const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Manual-add JSON body — admin pastes (image URL + reference page URL) in
// the network-candidate modal. Always source="network"; user uploads still
// go through the multipart branch unchanged.
const ManualAddBody = z.object({
  source: z.literal("network"),
  imageUrl: z.string().url().max(2048),
  sourceUrl: z.string().url().max(2048),
});

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const requestedPath = new URL(req.url).searchParams.get("path");
  if (!requestedPath) {
    return new NextResponse("missing ?path", { status: 400 });
  }

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, rarity: true, candidateImages: true },
  });
  if (!relic) return new NextResponse("not found", { status: 404 });
  if (!requestedPath.startsWith(`/${relic.slug}/`)) {
    return new NextResponse("path not in this relic's namespace", { status: 403 });
  }

  // Verify the path is in the candidateImages array.
  if (!Array.isArray(relic.candidateImages)) {
    return new NextResponse("relic has no candidate images", { status: 404 });
  }
  const known = (relic.candidateImages as unknown[]).some(
    (c) => isObject(c) && c.path === requestedPath,
  );
  if (!known) {
    return new NextResponse("path not in candidate set", { status: 404 });
  }

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const abs = resolveRelicAsset(requestedPath);
  if (!abs) return new NextResponse("forbidden", { status: 403 });

  try {
    const { buf, contentType } = await serveImageFile(abs);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    };
    if (new URL(req.url).searchParams.get("download") === "1") {
      const match = (relic.candidateImages as unknown[]).find(
        (c) => isObject(c) && c.path === requestedPath,
      );
      const name =
        (isObject(match) && typeof match.originalFilename === "string"
          ? match.originalFilename
          : path.basename(abs));
      headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(name)}"`;
    }
    return new NextResponse(buf, { status: 200, headers });
  } catch (e) {
    console.error("[api/relics/candidate] read failed", { id, e });
    return new NextResponse("not found", { status: 404 });
  }
}

// POST /api/relics/[id]/candidate — admin-only. Two modes by Content-Type:
//
//   multipart/form-data → existing path. File upload + source field. User
//                          and network candidates both supported (the file
//                          itself is the bytes).
//   application/json    → manual-add network candidate. Body is
//                          { source: "network", imageUrl, sourceUrl }. Server
//                          fetches imageUrl (SSRF-defended), persists to
//                          derived/cand-network-<ts>.<ext>, attaches the
//                          reference page URL as candidate.sourceUrl.
//
// Both branches save to private/relics/<slug>/derived/cand-{source}-<ts>.<ext>
// and append to Relic.candidateImages.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    try {
      await requireAdmin();
    } catch (e) {
      if (e instanceof AuthError) return respondAuthError(e);
      throw e;
    }
    const { id } = await ctx.params;
    const relic = await prisma.relic.findUnique({
      where: { id },
      select: { id: true, slug: true, candidateImages: true },
    });
    if (!relic) return respondError(AgentErrorCode.NOT_FOUND, "relic not found", 404);

    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    const isJson = contentType.includes("application/json");

    let buf: Buffer;
    let ext: string;
    let source: "user" | "network";
    let originalFilename: string;
    let sourceUrl: string | undefined;

    if (isJson) {
      // — Manual-add (JSON) branch — — — — — — — — — — — — — — — — — — — —
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return respondError(AgentErrorCode.INVALID_JSON, "invalid JSON body", 400);
      }
      const parsed = ManualAddBody.safeParse(body);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        return respondError(
          AgentErrorCode.VALIDATION_FAILED,
          `invalid manual-add body: ${detail}`,
          400,
        );
      }
      const { imageUrl, sourceUrl: ref } = parsed.data;
      try {
        const fetched = await fetchExternalImage(imageUrl, {
          maxBytes: MAX_UPLOAD_BYTES,
        });
        buf = fetched.buffer;
        ext = fetched.ext;
      } catch (e) {
        if (e instanceof FetchExternalImageError) {
          // Map the fetcher's error codes to user-friendly HTTP responses.
          // SSRF / private-host attempts surface as 400 (bad input) not 500.
          const status =
            e.code === "TOO_LARGE"
              ? 413
              : e.code === "TIMEOUT" || e.code === "HTTP_ERROR"
                ? 502
                : 400;
          return respondError(AgentErrorCode.VALIDATION_FAILED, e.message, status);
        }
        throw e;
      }
      source = "network";
      originalFilename = imageUrl.slice(0, 256);
      sourceUrl = ref;
    } else {
      // — Multipart upload branch (legacy / file picker) — — — — — — — — —
      const form = await req.formData().catch(() => null);
      if (!form) return respondError(AgentErrorCode.INVALID_FORM, "invalid form", 400);
      const file = form.get("file");
      if (!(file instanceof File)) {
        return respondError(AgentErrorCode.MISSING_FILE, "missing file", 400);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return respondError(AgentErrorCode.VALIDATION_FAILED, "file too large", 413);
      }
      const fileExt = path.extname(file.name).toLowerCase() || ".jpg";
      if (!ALLOWED_EXTS.has(fileExt)) {
        return respondError(
          AgentErrorCode.VALIDATION_FAILED,
          `unsupported extension: ${fileExt}`,
          400,
        );
      }
      const sourceField = form.get("source");
      source = sourceField === "network" ? "network" : "user";
      buf = Buffer.from(await file.arrayBuffer());
      ext = fileExt;
      originalFilename = file.name.slice(0, 256);
      // Manual-add network uploads carry a reference page URL alongside
      // the image file (paired in the modal's Manual tab). User-source
      // uploads have no `sourceUrl` field — leave undefined so it doesn't
      // pollute the candidate row.
      if (source === "network") {
        const refField = form.get("sourceUrl");
        if (typeof refField === "string" && refField.trim()) {
          const trimmed = refField.trim();
          if (trimmed.length > 2048) {
            return respondError(
              AgentErrorCode.VALIDATION_FAILED,
              "sourceUrl exceeds 2048 chars",
              400,
            );
          }
          try {
            const u = new URL(trimmed);
            if (u.protocol !== "http:" && u.protocol !== "https:") {
              return respondError(
                AgentErrorCode.VALIDATION_FAILED,
                "sourceUrl must be http(s)",
                400,
              );
            }
            sourceUrl = trimmed;
          } catch {
            return respondError(
              AgentErrorCode.VALIDATION_FAILED,
              "sourceUrl is not a valid URL",
              400,
            );
          }
        }
      }
    }

    const dirs = pipelineDirsForSlug(relic.slug);
    await fs.mkdir(dirs.derived, { recursive: true });
    const fname = `cand-${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const abs = path.join(dirs.derived, fname);
    await fs.writeFile(abs, buf);

    const newCandidate: {
      path: string;
      source: "user" | "network";
      originalFilename: string;
      score: number;
      deleted: boolean;
      sourceUrl?: string;
    } = {
      path: `/${relic.slug}/derived/${fname}`,
      source,
      originalFilename,
      score: 50,
      deleted: false,
    };
    if (sourceUrl) newCandidate.sourceUrl = sourceUrl;

    // Atomic JSONB append. The previous read+merge+write pattern raced
    // catastrophically when the modal's "批量加入" worker pool fired N
    // concurrent POSTs: each worker read the same `existing` snapshot,
    // appended its own candidate, and the second writer's update silently
    // overwrote the first writer's append. Files landed on disk but the
    // DB ended up with only ~1/3 of the candidates — the lost ones then
    // surfaced as broken thumbnails because the GET endpoint's
    // "path not in candidate set" check 404'd them.
    //
    // Using `||` (jsonb concat) in a single UPDATE statement makes this
    // a single SQL operation; postgres serializes concurrent UPDATEs on
    // the same row, so each append now sees prior appends as committed.
    // COALESCE handles NULL → empty-array on first write.
    await prisma.$executeRaw`
      UPDATE "Relic"
      SET "candidateImages" = COALESCE("candidateImages", '[]'::jsonb) || ${JSON.stringify([newCandidate])}::jsonb
      WHERE "id" = ${id}
    `;
    return NextResponse.json({ candidate: newCandidate });
  } catch (e) {
    console.error("[api/relics/candidate] upload failed", e);
    return respondError(
      AgentErrorCode.HANDLER_ERROR,
      `upload error: ${(e as Error).message}`,
      500,
    );
  }
}
