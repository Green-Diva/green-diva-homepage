// GET /api/relic-drafts/[id]/primary — streams the draft's recommended
// primary image (RelicDraft.generatedMetadata.primaryImagePath). Used by
// the preview modal as the hero thumbnail before confirm.
//
// Admin-only and namespace-scoped: the resolved path must live under
// /_drafts/<id>/.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { serveImageFile } from "@/lib/relics/serveImage";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return new NextResponse(e.message, { status: e.status });
    }
    throw e;
  }

  const { id } = await ctx.params;
  const draft = await prisma.relicDraft.findUnique({
    where: { id },
    select: { generatedMetadata: true },
  });
  if (!draft) return new NextResponse("not found", { status: 404 });
  const meta = isObject(draft.generatedMetadata) ? draft.generatedMetadata : null;
  const primary = meta && typeof meta.primaryImagePath === "string" ? meta.primaryImagePath : null;
  if (!primary) return new NextResponse("no primary image", { status: 404 });
  if (!primary.startsWith(`/_drafts/${id}/`)) {
    return new NextResponse("path not in this draft's namespace", { status: 403 });
  }

  const abs = resolveRelicAsset(primary);
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
    console.error("[api/relic-drafts/primary] read failed", { id, e });
    return new NextResponse("not found", { status: 404 });
  }
}
