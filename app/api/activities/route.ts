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
  const content = parsed.data.content.trim();

  // Idempotency: skip if same content was posted within last 5 seconds
  const recent = await prisma.activity.findFirst({
    where: {
      userId: me.id,
      content,
      createdAt: { gte: new Date(Date.now() - 5000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    return NextResponse.json(recent, { status: 200 });
  }

  const created = await prisma.activity.create({
    data: { userId: me.id, content },
  });
  return NextResponse.json(created, { status: 201 });
}
