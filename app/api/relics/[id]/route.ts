import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { AuthError, getCurrentUser, requireAdmin } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { relicUpdateSchema } from "@/lib/relicValidators";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const relic = await prisma.relic.findUnique({ where: { id } });
  if (!relic) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  const access = canAccessRelic(relic, user, unlockedIds);
  if (!access.ok) {
    return NextResponse.json(
      {
        error: "locked",
        reason: access.reason,
        ...(access.reason === "needs-level" ? { required: access.required } : {}),
        rarity: relic.rarity,
      },
      { status: 403 },
    );
  }
  // strip passwordHash
  const { passwordHash: _ph, ...safe } = relic;
  void _ph;
  return NextResponse.json(safe);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = relicUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const update: Record<string, unknown> = { ...data };
  if ("password" in data) {
    update.passwordHash = data.password ? await bcrypt.hash(data.password, 12) : null;
    delete update.password;
  }
  if ("acquiredAt" in data) {
    update.acquiredAt = data.acquiredAt ? new Date(data.acquiredAt) : null;
  }
  try {
    await prisma.relic.update({ where: { id }, data: update });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/relics PATCH] update failed", e);
    return NextResponse.json({ error: "update failed" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;
  try {
    await prisma.relic.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/relics DELETE] delete failed", e);
    return NextResponse.json({ error: "delete failed" }, { status: 400 });
  }
}
