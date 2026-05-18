// GET /api/relics/[id]/enhanced — streams an entry from Relic.enhancedImages.
//
// Query param ?path=<encoded> picks a specific entry from the array
// (validated against the row's stored paths). Omitted → first entry,
// for back-compat with detail-page <img src=...> usage that predates
// the array shape. Same access policy + caching as /primary.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { inferContentType, resolveRelicAsset } from "@/lib/relicStorage";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, rarity: true, enhancedImages: true },
  });
  if (!relic) return new NextResponse("not found", { status: 404 });

  const list: Array<{ path?: string }> = Array.isArray(relic.enhancedImages)
    ? (relic.enhancedImages as Array<{ path?: string }>)
    : [];
  if (list.length === 0) return new NextResponse("no enhanced image", { status: 404 });

  const requestedPath = req.nextUrl.searchParams.get("path");
  let targetPath: string | null = null;
  if (requestedPath) {
    const found = list.find((e) => e.path === requestedPath);
    if (!found || !found.path) {
      return new NextResponse("not found", { status: 404 });
    }
    targetPath = found.path;
  } else {
    targetPath = list[0].path ?? null;
  }
  if (!targetPath) return new NextResponse("no enhanced image", { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const abs = resolveRelicAsset(targetPath);
  if (!abs) return new NextResponse("forbidden", { status: 403 });

  try {
    const buf = await fs.readFile(abs);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": inferContentType(abs),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("[api/relics/enhanced] read failed", { id, e });
    return new NextResponse("not found", { status: 404 });
  }
}
