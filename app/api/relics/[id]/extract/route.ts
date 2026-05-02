import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { getSharedRelicIds } from "@/lib/relicShare";
import { getGrantedRelicIds } from "@/lib/relicGrant";
import { recordRelicLog } from "@/lib/relicLog";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await ctx.params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, nameEn: true, slot: true, rarity: true, extractedAt: true },
  });
  if (!relic) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (relic.extractedAt) {
    return NextResponse.json({ error: "already extracted" }, { status: 410 });
  }

  const [unlockedIds, sharedIds, grantedIds] = await Promise.all([
    getUnlockedRelicIds(),
    getSharedRelicIds(me.id),
    getGrantedRelicIds(me.id),
  ]);
  const access = canAccessRelic(relic, me, unlockedIds, sharedIds, grantedIds);
  if (access.level !== "GREEN") {
    return NextResponse.json({ error: "forbidden", reason: access.reason }, { status: 403 });
  }

  try {
    await prisma.relic.update({
      where: { id },
      data: { extractedAt: new Date(), extractedById: me.id },
    });
    await recordRelicLog({
      action: "EXTRACTED",
      relic: { id: relic.id, slug: relic.slug, name: relic.nameEn },
      actor: { id: me.id, name: me.name },
      target: { id: me.id, name: me.name },
      details: { slot: relic.slot, rarity: relic.rarity },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/relics extract] failed", e);
    return NextResponse.json({ error: "extract failed" }, { status: 400 });
  }
}
