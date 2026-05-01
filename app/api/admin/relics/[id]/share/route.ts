import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";

const postBody = z.object({ userId: z.string().min(1).max(64) });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;
  const shares = await prisma.relicShare.findMany({
    where: { relicId: id },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      user: { select: { name: true, level: true, serial: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(shares);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = postBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const [relic, user] = await Promise.all([
    prisma.relic.findUnique({ where: { id }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true } }),
  ]);
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  try {
    await prisma.relicShare.upsert({
      where: { relicId_userId: { relicId: id, userId: user.id } },
      update: { sharedById: me.id },
      create: { relicId: id, userId: user.id, sharedById: me.id },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/admin/relics/share POST] failed", e);
    return NextResponse.json({ error: "share failed" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  try {
    await prisma.relicShare.delete({
      where: { relicId_userId: { relicId: id, userId } },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/admin/relics/share DELETE] failed", e);
    return NextResponse.json({ error: "revoke failed" }, { status: 400 });
  }
}
