// GET /api/relics/[id]/enhanced — streams Relic.enhancedImagePath bytes.
// Same access policy + caching as /primary; mirrors that file's structure.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { inferContentType, resolveRelicAsset } from "@/lib/relicStorage";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, rarity: true, enhancedImagePath: true },
  });
  if (!relic) return new NextResponse("not found", { status: 404 });
  if (!relic.enhancedImagePath) return new NextResponse("no enhanced image", { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const abs = resolveRelicAsset(relic.enhancedImagePath);
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
