import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { skillCreateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";

export async function GET() {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const skills = await prisma.skill.findMany({
    orderBy: [{ level: "asc" }, { kind: "asc" }],
    include: { createdBy: { select: { id: true, name: true } } },
  });
  return NextResponse.json(skills);
}

export async function POST(req: NextRequest) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = skillCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const skill = await prisma.skill.create({
      data: { ...parsed.data, createdById: me.id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json(skill, { status: 201 });
  } catch (e) {
    console.error("[skills] create failed", e);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
