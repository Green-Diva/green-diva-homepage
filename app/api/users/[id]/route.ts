import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { userUpdateSchema } from "@/lib/validators";
import { ADMIN_LEVEL, AuthError, generateToken, requireAdmin } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    ...u,
    token: u.token.length > 8 ? `${u.token.slice(0, 4)}…${u.token.slice(-4)}` : "••••",
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const url = new URL(req.url);
  const regenerate = url.searchParams.get("regenerate") === "1";

  const json = await req.json().catch(() => ({}));
  const parsed = userUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // protect last priestess from being demoted
  if (parsed.data.level !== undefined && parsed.data.level < ADMIN_LEVEL) {
    const target = await prisma.user.findUnique({ where: { id } });
    if (target && target.level >= ADMIN_LEVEL) {
      const remaining = await prisma.user.count({
        where: { level: { gte: ADMIN_LEVEL }, NOT: { id } },
      });
      if (remaining === 0) {
        return NextResponse.json(
          { error: "Cannot demote the only remaining priestess." },
          { status: 400 },
        );
      }
    }
  }

  const data: Record<string, unknown> = { ...parsed.data };
  if (regenerate) {
    data.token = generateToken();
  }
  // strip token from body unless explicit
  if (!regenerate && "token" in data && !data.token) {
    delete data.token;
  }

  try {
    const updated = await prisma.user.update({ where: { id }, data });
    if (regenerate) {
      // invalidate existing sessions when token is rotated
      await prisma.session.deleteMany({ where: { userId: id } });
    }
    return NextResponse.json({
      ...updated,
      token: regenerate
        ? updated.token
        : updated.token.length > 8
          ? `${updated.token.slice(0, 4)}…${updated.token.slice(-4)}`
          : "••••",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  if (id === me.id) {
    return NextResponse.json({ error: "Cannot remove yourself." }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.level >= ADMIN_LEVEL) {
    const remaining = await prisma.user.count({
      where: { level: { gte: ADMIN_LEVEL }, NOT: { id } },
    });
    if (remaining === 0) {
      return NextResponse.json(
        { error: "Cannot remove the only remaining priestess." },
        { status: 400 },
      );
    }
  }
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
