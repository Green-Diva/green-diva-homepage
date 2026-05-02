import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { resolveRelicAsset } from "@/lib/relicStorage";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, rarity: true, archivePath: true },
  });
  if (!relic) return new NextResponse("not found", { status: 404 });
  if (!relic.archivePath) return new NextResponse("not found", { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const abs = resolveRelicAsset(relic.archivePath);
  if (!abs) return new NextResponse("forbidden", { status: 403 });

  try {
    const buf = await fs.readFile(abs);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${relic.slug}-archive.zip"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("[api/relics/archive] read failed", { id, e });
    return new NextResponse("not found", { status: 404 });
  }
}
