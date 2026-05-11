import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentSkillEquipSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";
import { SKILL_SLOT_COUNT } from "@/lib/agentTypes";

const CAPACITY_SENTINEL = "EQUIP_CAPACITY_EXCEEDED";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;
  const equips = await prisma.agentSkillEquip.findMany({
    where: { agentId: id },
    include: {
      skill: { include: { createdBy: { select: { id: true, name: true } } } },
    },
    orderBy: [{ slotIndex: "asc" }, { skill: { level: "asc" } }],
  });
  return NextResponse.json(equips);
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id: agentId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = agentSkillEquipSchema.safeParse(json);
  if (!parsed.success) {
    return respondValidationError(parsed.error.flatten());
  }
  const { skillId, unlocked, slotIndex } = parsed.data;

  try {
    const equip = await prisma.$transaction(async (tx) => {
      // If a slotIndex is given, free that slot first (an admin re-equipping
      // should always succeed; old slot occupant gets evicted).
      if (typeof slotIndex === "number") {
        await tx.agentSkillEquip.deleteMany({
          where: { agentId, slotIndex },
        });
      }
      // Same skill cannot be equipped twice on the same agent.
      const existing = await tx.agentSkillEquip.findUnique({
        where: { agentId_skillId: { agentId, skillId } },
      });
      if (existing) {
        // Move the existing equip to the requested slot instead of erroring.
        return tx.agentSkillEquip.update({
          where: { id: existing.id },
          data: {
            slotIndex: typeof slotIndex === "number" ? slotIndex : existing.slotIndex,
            unlocked: typeof unlocked === "boolean" ? unlocked : existing.unlocked,
          },
          include: {
            skill: { include: { createdBy: { select: { id: true, name: true } } } },
          },
        });
      }
      // Cap total equips per agent at SKILL_SLOT_COUNT (6). Without this, repeated
      // POSTs without slotIndex would silently pile up `slotIndex=null` rows that
      // the UI cannot show but a future invokeAgent would still iterate over.
      const currentCount = await tx.agentSkillEquip.count({ where: { agentId } });
      if (currentCount >= SKILL_SLOT_COUNT) {
        throw new Error(CAPACITY_SENTINEL);
      }
      return tx.agentSkillEquip.create({
        data: {
          agentId,
          skillId,
          unlocked: unlocked ?? false,
          slotIndex: typeof slotIndex === "number" ? slotIndex : null,
        },
        include: {
          skill: { include: { createdBy: { select: { id: true, name: true } } } },
        },
      });
    });
    return NextResponse.json(equip, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === CAPACITY_SENTINEL) {
      return respondError("EQUIP_CAPACITY_EXCEEDED", "equip capacity exceeded", 409);
    }
    console.error("[agent-skills] equip failed", e);
    return respondError("EQUIP_FAILED", "equip failed", 500);
  }
}
