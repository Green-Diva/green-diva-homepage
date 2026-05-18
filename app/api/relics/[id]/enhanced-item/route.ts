// DELETE /api/relics/[id]/enhanced-item?path=<encoded>
// Admin-only. Removes a single entry from Relic.enhancedImages by its
// path, plus a best-effort unlink of the underlying derived/ file.
// File unlink failures are logged + ignored — the DB entry is the source
// of truth for "exists" semantics; admin can rerun later to clean up.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { resolveRelicAsset } from "@/lib/relicStorage";
import type { Prisma } from "@prisma/client";

type EnhancedEntry = {
  path?: string;
  sourceCandidatePath?: string;
  [k: string]: unknown;
};

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await ctx.params;
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "missing ?path" }, { status: 400 });

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, enhancedImages: true },
  });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });

  const arr: EnhancedEntry[] = Array.isArray(relic.enhancedImages)
    ? (relic.enhancedImages as EnhancedEntry[])
    : [];
  const idx = arr.findIndex((e) => e.path === path);
  if (idx === -1) {
    return NextResponse.json({ error: "path not in enhancedImages" }, { status: 404 });
  }

  const next = arr.slice();
  next.splice(idx, 1);
  await prisma.relic.update({
    where: { id },
    data: { enhancedImages: next as unknown as Prisma.InputJsonValue },
  });

  // Best-effort file unlink. Only attempts paths the resolver accepts
  // (within the relic storage root), so a malformed entry can't be used
  // to traverse outside private/relics/.
  const abs = resolveRelicAsset(path);
  if (abs) {
    fs.unlink(abs).catch((e) => {
      console.warn(`[api/relics/enhanced-item] unlink failed for ${abs}:`, e);
    });
  }

  return new NextResponse(null, { status: 204 });
}
