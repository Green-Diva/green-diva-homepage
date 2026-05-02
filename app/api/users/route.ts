import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { userCreateSchema } from "@/lib/validators";
import { AuthError, generateToken, requireAdmin } from "@/lib/auth";
import { MASKED_TOKEN, deriveTokenLookup, hashToken } from "@/lib/userToken";

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
    },
  });
  // Tokens are bcrypt-hashed; plaintext is unrecoverable. Surface a placeholder.
  return NextResponse.json(
    users.map((u) => ({
      ...u,
      token: MASKED_TOKEN,
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
  const token = data.token ?? generateToken();
  const tokenHash = await hashToken(token);
  const tokenLookup = deriveTokenLookup(token);

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
          tokenHash,
          tokenLookup,
        },
        select: {
          id: true,
          serial: true,
          name: true,
          gender: true,
          level: true,
          avatarUrl: true,
          createdAt: true,
        },
      });
    });
    // Plaintext is returned ONCE here. After this response it is unrecoverable.
    return NextResponse.json({ ...created, token }, { status: 201 });
  } catch (e: unknown) {
    console.error("[api/users POST] create failed", e);
    return NextResponse.json({ error: "create failed" }, { status: 400 });
  }
}
