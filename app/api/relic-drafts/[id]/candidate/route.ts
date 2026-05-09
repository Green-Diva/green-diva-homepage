// GET /api/relic-drafts/[id]/candidate?path=<draft-scoped-path> — streams a
// single candidate image referenced from RelicDraft.generatedMetadata.candidateImages.
// Used by the draft preview modal to render thumbnails.
//
// Same defense pattern as /api/relics/[id]/candidate: ?path must (a) start
// with /_drafts/<this-draft-id>/ (b) appear in the stored candidate set.
// Admin-only — drafts are never visible to non-admins anyway.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { serveImageFile } from "@/lib/relics/serveImage";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return new NextResponse(e.message, { status: e.status });
    }
    throw e;
  }

  const { id } = await ctx.params;
  const requestedPath = new URL(req.url).searchParams.get("path");
  if (!requestedPath) {
    return new NextResponse("missing ?path", { status: 400 });
  }

  const draft = await prisma.relicDraft.findUnique({
    where: { id },
    select: { id: true, generatedMetadata: true },
  });
  if (!draft) return new NextResponse("not found", { status: 404 });
  if (!requestedPath.startsWith(`/_drafts/${id}/`)) {
    return new NextResponse("path not in this draft's namespace", { status: 403 });
  }

  const meta = isObject(draft.generatedMetadata) ? draft.generatedMetadata : null;
  const cand = meta && Array.isArray(meta.candidateImages) ? meta.candidateImages : null;
  if (!cand) {
    return new NextResponse("draft has no candidate images", { status: 404 });
  }
  const known = cand.some((c) => isObject(c) && c.path === requestedPath);
  if (!known) {
    return new NextResponse("path not in candidate set", { status: 404 });
  }

  const abs = resolveRelicAsset(requestedPath);
  if (!abs) return new NextResponse("forbidden", { status: 403 });

  try {
    const { buf, contentType } = await serveImageFile(abs);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("[api/relic-drafts/candidate] read failed", { id, e });
    return new NextResponse("not found", { status: 404 });
  }
}
