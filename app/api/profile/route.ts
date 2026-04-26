import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { profileUpdateSchema } from "@/lib/validators";
import { AuthError, requireUser } from "@/lib/auth";

export async function PATCH(req: NextRequest) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = profileUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: me.id },
    data: { bio: parsed.data.bio ?? null },
    select: { bio: true },
  });
  return NextResponse.json(updated);
}
