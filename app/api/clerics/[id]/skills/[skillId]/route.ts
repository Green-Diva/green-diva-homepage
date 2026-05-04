import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clericSkillUnlockSchema } from "@/lib/validators";
import { AuthError, requireAdmin } from "@/lib/auth";

type Params = { params: Promise<{ id: string; skillId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id: clericId, skillId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = clericSkillUnlockSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const equip = await prisma.clericSkillEquip.update({
      where: { clericId_skillId: { clericId, skillId } },
      data: { unlocked: parsed.data.unlocked },
      include: {
        skill: { include: { createdBy: { select: { id: true, name: true } } } },
      },
    });
    return NextResponse.json(equip);
  } catch (e) {
    console.error("[cleric-skills] update failed", e);
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
  const { id: clericId, skillId } = await params;
  try {
    await prisma.clericSkillEquip.delete({
      where: { clericId_skillId: { clericId, skillId } },
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[cleric-skills] unequip failed", e);
    return NextResponse.json({ error: "unequip failed" }, { status: 500 });
  }
}
