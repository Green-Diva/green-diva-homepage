import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentSkillUnlockSchema } from "@/lib/validators";
import { AuthError, requireAdmin } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";

type Params = { params: Promise<{ id: string; skillId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id: agentId, skillId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = agentSkillUnlockSchema.safeParse(json);
  if (!parsed.success) {
    return respondValidationError(parsed.error.flatten());
  }
  const { unlocked, slotIndex } = parsed.data;
  if (typeof unlocked !== "boolean" && slotIndex === undefined) {
    return respondError("NO_FIELDS_TO_UPDATE", "no fields to update", 400);
  }

  try {
    const equip = await prisma.$transaction(async (tx) => {
      // Free the target slot first if we're moving into one.
      if (typeof slotIndex === "number") {
        await tx.agentSkillEquip.deleteMany({
          where: { agentId, slotIndex, NOT: { skillId } },
        });
      }
      return tx.agentSkillEquip.update({
        where: { agentId_skillId: { agentId, skillId } },
        data: {
          ...(typeof unlocked === "boolean" ? { unlocked } : {}),
          ...(slotIndex !== undefined ? { slotIndex } : {}),
        },
        include: {
          skill: { include: { createdBy: { select: { id: true, name: true } } } },
        },
      });
    });
    return NextResponse.json(equip);
  } catch (e) {
    console.error("[agent-skills] update failed", e);
    return respondError("UPDATE_FAILED", "update failed", 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id: agentId, skillId } = await params;
  try {
    await prisma.agentSkillEquip.delete({
      where: { agentId_skillId: { agentId, skillId } },
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[agent-skills] unequip failed", e);
    return respondError("UNEQUIP_FAILED", "unequip failed", 500);
  }
}
