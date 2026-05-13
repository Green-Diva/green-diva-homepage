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
import { prisma } from "@/lib/db";
import { AuthError, getCurrentUser, requireAdmin } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { serveImageFile } from "@/lib/relics/serveImage";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { respondError, respondAuthError } from "@/lib/api-error";

const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

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

// POST /api/relics/[id]/candidate — admin-only. Uploads an additional
// image into the relic's user-uploaded candidate set. Saves to
// private/relics/<slug>/derived/cand-user-<ts>.<ext>, appends to
// Relic.candidateImages (source: "user"), and returns the new entry.
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
    if (!relic) return respondError("NOT_FOUND", "relic not found", 404);

    const form = await req.formData().catch(() => null);
    if (!form) return respondError("VALIDATION_FAILED", "invalid form", 400);
    const file = form.get("file");
    if (!(file instanceof File)) {
      return respondError("VALIDATION_FAILED", "missing file", 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return respondError("VALIDATION_FAILED", "file too large", 413);
    }
    const ext = path.extname(file.name).toLowerCase() || ".jpg";
    if (!ALLOWED_EXTS.has(ext)) {
      return respondError("VALIDATION_FAILED", `unsupported extension: ${ext}`, 400);
    }
    const sourceField = form.get("source");
    const source: "user" | "network" =
      sourceField === "network" ? "network" : "user";

    const dirs = pipelineDirsForSlug(relic.slug);
    await fs.mkdir(dirs.derived, { recursive: true });
    const fname = `cand-${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const abs = path.join(dirs.derived, fname);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(abs, buf);

    const newCandidate = {
      path: `/${relic.slug}/derived/${fname}`,
      source,
      originalFilename: file.name.slice(0, 256),
      score: 50,
      deleted: false,
    };
    const existing = Array.isArray(relic.candidateImages)
      ? (relic.candidateImages as unknown[])
      : [];
    const next = [...existing, newCandidate];
    await prisma.relic.update({
      where: { id },
      data: { candidateImages: next as unknown as Prisma.InputJsonValue },
    });
    return NextResponse.json({ candidate: newCandidate });
  } catch (e) {
    console.error("[api/relics/candidate] upload failed", e);
    return respondError("HANDLER_ERROR", `upload error: ${(e as Error).message}`, 500);
  }
}
