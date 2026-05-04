import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clericSkillEquipSchema } from "@/lib/validators";
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
  const equips = await prisma.clericSkillEquip.findMany({
    where: { clericId: id },
    include: {
      skill: { include: { createdBy: { select: { id: true, name: true } } } },
    },
    orderBy: { skill: { level: "asc" } },
  });
  return NextResponse.json(equips);
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id: clericId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = clericSkillEquipSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { skillId, unlocked } = parsed.data;
  const existing = await prisma.clericSkillEquip.findUnique({
    where: { clericId_skillId: { clericId, skillId } },
  });
  if (existing) {
    return NextResponse.json({ error: "already equipped" }, { status: 409 });
  }
  try {
    const equip = await prisma.clericSkillEquip.create({
      data: { clericId, skillId, unlocked: unlocked ?? false },
      include: {
        skill: { include: { createdBy: { select: { id: true, name: true } } } },
      },
    });
    return NextResponse.json(equip, { status: 201 });
  } catch (e) {
    console.error("[cleric-skills] equip failed", e);
    return NextResponse.json({ error: "equip failed" }, { status: 500 });
  }
}
