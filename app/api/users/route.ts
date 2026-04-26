import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { userCreateSchema } from "@/lib/validators";
import { ADMIN_LEVEL, AuthError, generateToken, requireAdmin } from "@/lib/auth";

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const users = await prisma.user.findMany({
    orderBy: [{ serial: "asc" }],
    select: {
      id: true,
      serial: true,
      name: true,
      gender: true,
      level: true,
      avatarUrl: true,
      createdAt: true,
      token: true,
    },
  });
  // mask token in list
  return NextResponse.json(
    users.map((u) => ({
      ...u,
      token: maskToken(u.token),
    })),
  );
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = userCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  if (data.level >= ADMIN_LEVEL) {
    // allow creating another priestess; nothing special
  }
  const token = data.token ?? generateToken();

  try {
    const created = await prisma.$transaction(async (tx) => {
      const max = await tx.user.aggregate({ _max: { serial: true } });
      const nextSerial = (max._max.serial ?? 0) + 1;
      return tx.user.create({
        data: {
          serial: nextSerial,
          name: data.name,
          gender: data.gender ?? null,
          level: data.level,
          avatarUrl: data.avatarUrl ?? null,
          token,
        },
      });
    });
    // return full token ONCE
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

function maskToken(t: string): string {
  if (t.length <= 8) return "••••";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}
