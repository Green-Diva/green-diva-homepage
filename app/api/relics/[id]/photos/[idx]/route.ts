import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { inferContentType, resolveRelicAsset } from "@/lib/relicStorage";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; idx: string }> },
) {
  const { id, idx } = await ctx.params;
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0) return new NextResponse("bad index", { status: 400 });

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, rarity: true, photoPaths: true },
  });
  if (!relic) return new NextResponse("not found", { status: 404 });
  const photo = relic.photoPaths[i];
  if (!photo) return new NextResponse("not found", { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (!canAccessRelic(relic, user, unlockedIds).ok) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const abs = resolveRelicAsset(photo);
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
    console.error("[api/relics/photos] read failed", { id, idx, e });
    return new NextResponse("not found", { status: 404 });
  }
}
