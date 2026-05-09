// GET /api/relics/[id]/candidate?path=<slug-scoped-path> — streams a single
// candidate image referenced from Relic.candidateImages. Used by the
// CandidateImageGallery component in RelicForm to render thumbnails.
//
// Defense: ?path must (a) start with /<this-relic-slug>/ (b) appear in the
// stored candidateImages array. Both checks before resolveRelicAsset's
// path-traversal guard, so guessing arbitrary paths is rejected.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { serveImageFile } from "@/lib/relics/serveImage";

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
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("[api/relics/candidate] read failed", { id, e });
    return new NextResponse("not found", { status: 404 });
  }
}
