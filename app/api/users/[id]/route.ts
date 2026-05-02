import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { userUpdateSchema } from "@/lib/validators";
import { ADMIN_LEVEL, AuthError, generateToken, requireAdmin } from "@/lib/auth";
import { MASKED_TOKEN, deriveTokenLookup, hashToken } from "@/lib/userToken";
import { getDictionary } from "@/lib/i18n/server";

type Ctx = { params: Promise<{ id: string }> };

const PUBLIC_USER_SELECT = {
  id: true,
  serial: true,
  name: true,
  gender: true,
  level: true,
  avatarUrl: true,
  bio: true,
  attack: true,
  defense: true,
  hp: true,
  agility: true,
  luck: true,
  specialAttributes: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const u = await prisma.user.findUnique({ where: { id }, select: PUBLIC_USER_SELECT });
  if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...u, token: MASKED_TOKEN });
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
    const target = await prisma.user.findUnique({ where: { id }, select: { level: true } });
    if (target && target.level >= ADMIN_LEVEL) {
      const remaining = await prisma.user.count({
        where: { level: { gte: ADMIN_LEVEL }, NOT: { id } },
      });
      if (remaining === 0) {
        const t = await getDictionary();
        return NextResponse.json(
          { error: t.errors.cannotDemoteOnlyPriestess },
          { status: 400 },
        );
      }
    }
  }

  // Strip raw token from update payload — tokens are derived/hashed below.
  const { token: _ignored, ...rest } = parsed.data;
  void _ignored;
  const data: Record<string, unknown> = { ...rest };
  let issuedToken: string | null = null;
  if (regenerate) {
    issuedToken = generateToken();
    data.tokenHash = await hashToken(issuedToken);
    data.tokenLookup = deriveTokenLookup(issuedToken);
  }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data,
      select: PUBLIC_USER_SELECT,
    });
    if (regenerate) {
      // invalidate existing sessions when token is rotated
      await prisma.session.deleteMany({ where: { userId: id } });
    }
    return NextResponse.json({
      ...updated,
      token: issuedToken ?? MASKED_TOKEN,
    });
  } catch (e: unknown) {
    console.error("[api/users PATCH] update failed", e);
    return NextResponse.json({ error: "update failed" }, { status: 400 });
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
  const t = await getDictionary();
  if (id === me.id) {
    return NextResponse.json({ error: t.errors.cannotRemoveSelf }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { level: true } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.level >= ADMIN_LEVEL) {
    const remaining = await prisma.user.count({
      where: { level: { gte: ADMIN_LEVEL }, NOT: { id } },
    });
    if (remaining === 0) {
      return NextResponse.json(
        { error: t.errors.cannotRemoveOnlyPriestess },
        { status: 400 },
      );
    }
  }
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
