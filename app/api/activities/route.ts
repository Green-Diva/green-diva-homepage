import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activityCreateSchema } from "@/lib/validators";
import { AuthError, requireUser } from "@/lib/auth";

export async function GET() {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const items = await prisma.activity.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const json = await req.json().catch(() => null);
  const parsed = activityCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const created = await prisma.activity.create({
    data: { userId: me.id, content: parsed.data.content.trim() },
  });
  return NextResponse.json(created, { status: 201 });
}
