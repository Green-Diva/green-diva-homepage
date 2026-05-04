import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { skillUpdateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const skill = await prisma.skill.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(skill);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = skillUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const skill = await prisma.skill.update({
      where: { id },
      data: parsed.data,
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json(skill);
  } catch (e) {
    console.error("[skills] update failed", e);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  try {
    await prisma.skill.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[skills] delete failed", e);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
