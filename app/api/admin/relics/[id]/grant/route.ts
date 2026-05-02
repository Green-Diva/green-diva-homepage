import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { recordRelicLog } from "@/lib/relicLog";

type Ctx = { params: Promise<{ id: string }> };

const grantBody = z.object({ userId: z.string().min(1).max(64) });

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const grants = await prisma.relicGrant.findMany({
    where: { relicId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      user: { select: { id: true, name: true, level: true, avatarUrl: true } },
      grantedBy: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ grants });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = grantBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const [relic, target] = await Promise.all([
    prisma.relic.findUnique({ where: { id }, select: { id: true, slug: true, nameEn: true } }),
    prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, name: true } }),
  ]);
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });

  try {
    await prisma.relicGrant.upsert({
      where: { relicId_userId: { relicId: id, userId: target.id } },
      create: { relicId: id, userId: target.id, grantedById: me.id },
      update: {},
    });
    await recordRelicLog({
      action: "GRANTED",
      relic: { id: relic.id, slug: relic.slug, name: relic.nameEn },
      actor: { id: me.id, name: me.name },
      target,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/admin/relics grant POST] failed", e);
    return NextResponse.json({ error: "grant failed" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const [relic, target] = await Promise.all([
    prisma.relic.findUnique({ where: { id }, select: { id: true, slug: true, nameEn: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } }),
  ]);
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });

  try {
    await prisma.relicGrant.deleteMany({ where: { relicId: id, userId } });
    await recordRelicLog({
      action: "GRANT_REVOKED",
      relic: { id: relic.id, slug: relic.slug, name: relic.nameEn },
      actor: { id: me.id, name: me.name },
      target: target ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/admin/relics grant DELETE] failed", e);
    return NextResponse.json({ error: "revoke failed" }, { status: 400 });
  }
}
