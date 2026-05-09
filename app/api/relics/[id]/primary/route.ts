import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { inferContentType, resolveRelicAsset } from "@/lib/relicStorage";

// Serves Relic.primaryImagePath — the 2D hero image picked / composed by
// the Relic Image Pick skill. Mirrors the pattern in /model and /derived:
// gates on the relic's access policy, resolves through resolveRelicAsset
// (which blocks path traversal), streams bytes back. Caches privately for
// an hour since the asset bytes don't change once the agent has written them.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, rarity: true, primaryImagePath: true },
  });
  if (!relic) return new NextResponse("not found", { status: 404 });
  if (!relic.primaryImagePath) return new NextResponse("no primary image", { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const abs = resolveRelicAsset(relic.primaryImagePath);
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
    console.error("[api/relics/primary] read failed", { id, e });
    return new NextResponse("not found", { status: 404 });
  }
}
